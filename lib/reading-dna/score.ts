/**
 * READING DNA — Compatibility Scoring
 *
 * Scores books against a user's DNA profile using dot products.
 * Sub-millisecond, no API calls.
 */

import type { DnaProfile } from "./compute";

export interface BookVector {
  bookId: string;
  vector: Record<string, number>; // trope slug → weight (1.0 for binary)
  spiceLevel: number | null; // composite spice score
}

export interface ScoredBook {
  bookId: string;
  score: number; // 0.0–1.0 normalized
  tropeOverlap: number; // raw dot product
  spiceBonus: number; // spice compatibility bonus
}

/**
 * Score a single book against a user's DNA profile.
 *
 * score = dotProduct(user.tropeAffinities, book.tropeVector)
 *       + spiceBonus(user.spicePreferred, book.spiceLevel, user.spiceTolerance)
 */
export function scoreBook(profile: DnaProfile, book: BookVector): ScoredBook {
  // Trope dot product
  let tropeOverlap = 0;
  for (const [trope, bookWeight] of Object.entries(book.vector)) {
    const userAffinity = profile.tropeAffinities[trope] ?? 0;
    tropeOverlap += userAffinity * bookWeight;
  }

  // Spice bonus: gaussian-shaped bonus centered on preferred spice
  let spiceBonus = 0;
  if (book.spiceLevel !== null) {
    const diff = Math.abs(book.spiceLevel - profile.spicePreferred);
    const tolerance = Math.max(profile.spiceTolerance, 0.5);
    // Gaussian: peaks at 0.2 when diff=0, drops off with tolerance
    spiceBonus = 0.2 * Math.exp(-(diff * diff) / (2 * tolerance * tolerance));
  }

  return {
    bookId: book.bookId,
    score: tropeOverlap + spiceBonus,
    tropeOverlap,
    spiceBonus,
  };
}

/**
 * Score and rank a batch of books against a user's DNA profile.
 * Returns top N books sorted by score descending.
 */
export function rankBooks(
  profile: DnaProfile,
  books: BookVector[],
  limit: number = 10
): ScoredBook[] {
  const scored = books.map((book) => scoreBook(profile, book));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
