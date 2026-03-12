/**
 * COMPOSITE SPICE SCORING ENGINE
 *
 * Computes a weighted spice score from multiple signals.
 * Source weights (higher = more trusted):
 *   community (1.0) > romance_io (0.85) > review_classifier (0.6)
 *   > llm_inference (0.4) > genre_bucketing (0.2)
 *
 * Each signal has its own confidence (0-1) which is multiplied
 * by the source weight to produce the final weighted average.
 */

import { getAdminClient } from "@/lib/supabase/admin";

const SOURCE_WEIGHTS: Record<string, number> = {
  community: 1.0,
  romance_io: 0.85,
  review_classifier: 0.6,
  llm_inference: 0.4,
  genre_bucketing: 0.2,
};

export type SpiceSource =
  | "community"
  | "romance_io"
  | "review_classifier"
  | "llm_inference"
  | "genre_bucketing";

export interface CompositeSpice {
  score: number;
  primarySource: SpiceSource;
  communityCount: number | null;
  signalCount: number;
  confidence: number;
  attribution: string;
}

export interface SpiceSignal {
  source: SpiceSource;
  spiceValue: number;
  confidence: number;
  evidence: Record<string, unknown>;
}

/**
 * Compute composite spice score from raw signals.
 * Pure function — no DB access. Useful for testing or when you already have signals.
 */
export function computeFromSignals(signals: SpiceSignal[]): CompositeSpice | null {
  if (signals.length === 0) return null;

  let weightedSum = 0;
  let weightSum = 0;
  let maxWeightedConfidence = 0;
  let bestSource: SpiceSource = signals[0].source;
  let communityCount: number | null = null;

  for (const signal of signals) {
    const sourceWeight = SOURCE_WEIGHTS[signal.source] ?? 0.1;
    const effectiveWeight = signal.confidence * sourceWeight;

    weightedSum += signal.spiceValue * effectiveWeight;
    weightSum += effectiveWeight;

    if (effectiveWeight > maxWeightedConfidence) {
      maxWeightedConfidence = effectiveWeight;
      bestSource = signal.source;
    }

    if (signal.source === "community" && signal.evidence?.rating_count != null) {
      communityCount = Number(signal.evidence.rating_count);
    }
  }

  if (weightSum === 0) return null;

  const score = Math.round((weightedSum / weightSum) * 10) / 10;

  return {
    score,
    primarySource: bestSource,
    communityCount,
    signalCount: signals.length,
    confidence: Math.round(maxWeightedConfidence * 100) / 100,
    attribution: getAttribution(bestSource, communityCount),
  };
}

/**
 * Fetch spice signals from DB and compute composite score for a book.
 */
export async function getCompositeSpice(bookId: string): Promise<CompositeSpice | null> {
  const supabase = getAdminClient();

  const { data: rows } = await supabase
    .from("spice_signals")
    .select("source, spice_value, confidence, evidence")
    .eq("book_id", bookId);

  if (!rows || rows.length === 0) return null;

  const signals: SpiceSignal[] = rows.map((row: Record<string, unknown>) => ({
    source: row.source as SpiceSource,
    spiceValue: Number(row.spice_value),
    confidence: Number(row.confidence),
    evidence: (row.evidence as Record<string, unknown>) ?? {},
  }));

  return computeFromSignals(signals);
}

/**
 * Fetch composite spice for multiple books at once (batch query).
 * Returns a Map of bookId → CompositeSpice.
 */
export async function getCompositeSpiceBatch(
  bookIds: string[]
): Promise<Map<string, CompositeSpice>> {
  if (bookIds.length === 0) return new Map();

  const supabase = getAdminClient();

  const { data: rows } = await supabase
    .from("spice_signals")
    .select("book_id, source, spice_value, confidence, evidence")
    .in("book_id", bookIds);

  if (!rows || rows.length === 0) return new Map();

  // Group signals by book_id
  const byBook = new Map<string, SpiceSignal[]>();
  for (const row of rows as Record<string, unknown>[]) {
    const bookId = row.book_id as string;
    if (!byBook.has(bookId)) byBook.set(bookId, []);
    byBook.get(bookId)!.push({
      source: row.source as SpiceSource,
      spiceValue: Number(row.spice_value),
      confidence: Number(row.confidence),
      evidence: (row.evidence as Record<string, unknown>) ?? {},
    });
  }

  const result = new Map<string, CompositeSpice>();
  byBook.forEach((signals, bookId) => {
    const composite = computeFromSignals(signals);
    if (composite) result.set(bookId, composite);
  });

  return result;
}

function getAttribution(source: SpiceSource, communityCount: number | null): string {
  switch (source) {
    case "community":
      return communityCount
        ? `based on ${communityCount} community rating${communityCount === 1 ? "" : "s"}`
        : "based on community ratings";
    case "romance_io":
      return "from Romance.io";
    case "review_classifier":
      return "estimated from reviews";
    case "llm_inference":
      return "estimated from description";
    case "genre_bucketing":
      return "estimated from genre";
    default:
      return "estimated";
  }
}
