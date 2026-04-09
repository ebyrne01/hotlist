/**
 * READING DNA — Computation Engine
 *
 * Pure math, no AI calls. Takes signal books + their tropes,
 * produces a normalized trope affinity vector (0.0–1.0 per trope).
 *
 * Used by: quiz save, import save, rating recalculation.
 */

export interface DnaSignal {
  bookId: string;
  weight: number; // 0.0–1.0
  tropes: string[]; // trope slugs on this book
}

export interface DnaProfile {
  tropeAffinities: Record<string, number>; // slug → 0.0–1.0
  spicePreferred: number; // 1.0–5.0
  spiceTolerance: number; // std dev
  signalCount: number;
}

/**
 * Signal weight constants for different interaction types.
 */
export const SIGNAL_WEIGHTS = {
  quiz_pick: 1.0,
  star_5: 1.0,
  star_4: 0.8,
  star_3: 0.6,
  star_2: 0.3,
  star_1: 0.0,
  gr_import_high: 0.9, // read + rated 4-5★
  gr_import_mid: 0.5, // read + rated 3★ or no rating
  gr_import_low: 0.0, // read + rated 1-2★ (disliked)
  gr_import_tbr: 0.3, // to-read shelf
  sg_import: 0.7,
  kindle_import: 0.5,
  scan: 0.6,
  // Legacy status weights (kept for backward compat)
  want_to_read: 0.3,
  reading: 0.5,
  // New reader response weights
  must_read: 0.3,
  on_the_shelf: 0.1,
  not_for_me: -0.5,
  loved_it: 1.0,
  it_was_fine: 0.7,
  didnt_finish: -0.9,
} as const;

/**
 * Compute trope affinity vector from weighted signals.
 *
 * Algorithm:
 * 1. For each trope, sum the weights of all signal books that have that trope
 * 2. Normalize: divide each by the max across all tropes → values 0.0 to 1.0
 *
 * This produces a unit vector where the user's strongest trope = 1.0.
 */
export function computeTropeAffinities(signals: DnaSignal[]): Record<string, number> {
  const rawScores: Record<string, number> = {};

  for (const signal of signals) {
    for (const trope of signal.tropes) {
      rawScores[trope] = (rawScores[trope] ?? 0) + signal.weight;
    }
  }

  // Normalize by max
  const maxScore = Math.max(...Object.values(rawScores), 0.001); // avoid div by zero
  const affinities: Record<string, number> = {};
  for (const [trope, score] of Object.entries(rawScores)) {
    affinities[trope] = Math.round((score / maxScore) * 100) / 100; // 2 decimal places
  }

  return affinities;
}

/**
 * Compute spice preference from explicit quiz picks + any rated books.
 *
 * quizSpice can be a single number, an array of selected levels, or null.
 * Multiple quiz selections widen the tolerance naturally.
 * Organic ratings shift the preference via weighted average over time.
 */
export function computeSpicePreference(
  quizSpice: number | number[] | null,
  ratedSpiceLevels: { level: number; weight: number }[]
): { preferred: number; tolerance: number } {
  const quizLevels = quizSpice === null ? [] : Array.isArray(quizSpice) ? quizSpice : [quizSpice];

  if (ratedSpiceLevels.length === 0 && quizLevels.length === 0) {
    return { preferred: 3.0, tolerance: 1.5 }; // neutral default
  }

  if (ratedSpiceLevels.length === 0 && quizLevels.length > 0) {
    const avg = quizLevels.reduce((a, b) => a + b, 0) / quizLevels.length;
    const preferred = Math.round(avg * 10) / 10;
    // Tolerance from range: single pick = 1.0, wider range = wider tolerance
    const range = Math.max(...quizLevels) - Math.min(...quizLevels);
    const tolerance = Math.max(range / 2, 0.5);
    return { preferred, tolerance: Math.round(tolerance * 10) / 10 };
  }

  // Weighted average of all spice data points
  const allPoints: { level: number; weight: number }[] = [];

  for (const level of quizLevels) {
    allPoints.push({ level, weight: 1.5 }); // quiz picks get extra weight
  }
  allPoints.push(...ratedSpiceLevels);

  const totalWeight = allPoints.reduce((sum, p) => sum + p.weight, 0);
  const weightedSum = allPoints.reduce((sum, p) => sum + p.level * p.weight, 0);
  const preferred = Math.round((weightedSum / totalWeight) * 10) / 10;

  // Tolerance = weighted std dev
  const variance =
    allPoints.reduce((sum, p) => sum + p.weight * (p.level - preferred) ** 2, 0) / totalWeight;
  const tolerance = Math.round(Math.sqrt(variance) * 10) / 10 || 0.5;

  return { preferred, tolerance };
}

/**
 * Build a complete DNA profile from signals.
 */
export function buildDnaProfile(
  signals: DnaSignal[],
  quizSpice: number | number[] | null,
  ratedSpiceLevels: { level: number; weight: number }[]
): DnaProfile {
  const tropeAffinities = computeTropeAffinities(signals);
  const { preferred, tolerance } = computeSpicePreference(quizSpice, ratedSpiceLevels);

  return {
    tropeAffinities,
    spicePreferred: preferred,
    spiceTolerance: tolerance,
    signalCount: signals.length,
  };
}
