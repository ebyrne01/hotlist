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
  want_to_read: 0.3,
  reading: 0.5,
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
 * Compute spice preference from explicit quiz pick + any rated books.
 *
 * If quiz spice is provided, it's used as the baseline.
 * Organic ratings shift it via weighted average over time.
 */
export function computeSpicePreference(
  quizSpice: number | null,
  ratedSpiceLevels: { level: number; weight: number }[]
): { preferred: number; tolerance: number } {
  if (ratedSpiceLevels.length === 0 && quizSpice !== null) {
    return { preferred: quizSpice, tolerance: 1.0 };
  }

  if (ratedSpiceLevels.length === 0 && quizSpice === null) {
    return { preferred: 3.0, tolerance: 1.5 }; // neutral default
  }

  // Weighted average of all spice data points
  const allPoints: { level: number; weight: number }[] = [];

  if (quizSpice !== null) {
    allPoints.push({ level: quizSpice, weight: 1.5 }); // quiz gets extra weight
  }
  allPoints.push(...ratedSpiceLevels);

  const totalWeight = allPoints.reduce((sum, p) => sum + p.weight, 0);
  const weightedSum = allPoints.reduce((sum, p) => sum + p.level * p.weight, 0);
  const preferred = Math.round((weightedSum / totalWeight) * 10) / 10;

  // Tolerance = weighted std dev
  const variance =
    allPoints.reduce((sum, p) => sum + p.weight * (p.level - preferred) ** 2, 0) / totalWeight;
  const tolerance = Math.round(Math.sqrt(variance) * 10) / 10 || 1.0;

  return { preferred, tolerance };
}

/**
 * Build a complete DNA profile from signals.
 */
export function buildDnaProfile(
  signals: DnaSignal[],
  quizSpice: number | null,
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
