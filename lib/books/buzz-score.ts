/**
 * BUZZ SCORE
 *
 * Computes a composite buzz score for books based on signals from
 * multiple discovery channels. Used to rank books for the "What's Hot"
 * carousel and future trending surfaces.
 *
 * Scoring approach:
 * - Each signal type has a base weight
 * - Signals decay over time (half-life: 7 days)
 * - Multiple signals from different sources compound
 *
 * Signal weights:
 *   nyt_bestseller:     5.0  (strongest — sustained mainstream visibility)
 *   booktok_grab:       3.0  (strong — real user engagement)
 *   amazon_bestseller:  2.0  (moderate — bestseller list appearance)
 *   reddit_mention:     1.5  (moderate — community buzz)
 */

import { getAdminClient } from "@/lib/supabase/admin";

const SIGNAL_WEIGHTS: Record<string, number> = {
  nyt_bestseller: 5.0,
  booktok_grab: 3.0,
  amazon_bestseller: 2.0,
  reddit_mention: 1.5,
};

/** Half-life in days — signals lose half their value after this many days */
const HALF_LIFE_DAYS = 7;

/** How far back to look for signals */
const LOOKBACK_DAYS = 30;

function decayFactor(daysAgo: number): number {
  return Math.pow(0.5, daysAgo / HALF_LIFE_DAYS);
}

export interface BuzzScoreResult {
  bookId: string;
  score: number;
  signalCount: number;
  sources: string[];
}

/**
 * Get buzz scores for the top N books by recent buzz activity.
 * Returns books sorted by buzz score descending.
 */
export async function getTopBuzzBooks(limit = 50): Promise<BuzzScoreResult[]> {
  const supabase = getAdminClient();
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data: signals } = await supabase
    .from("book_buzz_signals")
    .select("book_id, source, signal_date")
    .gte("signal_date", cutoff);

  if (!signals || signals.length === 0) return [];

  const today = new Date();
  const byBook = new Map<string, { score: number; sources: Set<string>; count: number }>();

  for (const signal of signals) {
    const signalDate = new Date(signal.signal_date);
    const daysAgo = (today.getTime() - signalDate.getTime()) / (24 * 60 * 60 * 1000);
    const weight = SIGNAL_WEIGHTS[signal.source] ?? 1.0;
    const decayed = weight * decayFactor(daysAgo);

    const entry = byBook.get(signal.book_id) ?? { score: 0, sources: new Set(), count: 0 };
    entry.score += decayed;
    entry.sources.add(signal.source);
    entry.count++;
    byBook.set(signal.book_id, entry);
  }

  // Diversity bonus: books with signals from multiple sources get a 1.5x multiplier
  const results: BuzzScoreResult[] = [];
  byBook.forEach((entry, bookId) => {
    const diversityMultiplier = entry.sources.size >= 2 ? 1.5 : 1.0;
    results.push({
      bookId,
      score: entry.score * diversityMultiplier,
      signalCount: entry.count,
      sources: Array.from(entry.sources),
    });
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Get buzz scores for specific book IDs.
 * Useful for augmenting existing book lists with buzz data.
 */
export async function getBuzzScoresForBooks(
  bookIds: string[]
): Promise<Map<string, number>> {
  if (bookIds.length === 0) return new Map();

  const supabase = getAdminClient();
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data: signals } = await supabase
    .from("book_buzz_signals")
    .select("book_id, source, signal_date")
    .in("book_id", bookIds)
    .gte("signal_date", cutoff);

  if (!signals || signals.length === 0) return new Map();

  const today = new Date();
  const scores = new Map<string, { score: number; sources: Set<string> }>();

  for (const signal of signals) {
    const daysAgo =
      (today.getTime() - new Date(signal.signal_date).getTime()) / (24 * 60 * 60 * 1000);
    const weight = SIGNAL_WEIGHTS[signal.source] ?? 1.0;
    const decayed = weight * decayFactor(daysAgo);

    const entry = scores.get(signal.book_id) ?? { score: 0, sources: new Set() };
    entry.score += decayed;
    entry.sources.add(signal.source);
    scores.set(signal.book_id, entry);
  }

  const result = new Map<string, number>();
  scores.forEach((entry, bookId) => {
    const diversityMultiplier = entry.sources.size >= 2 ? 1.5 : 1.0;
    result.set(bookId, entry.score * diversityMultiplier);
  });
  return result;
}
