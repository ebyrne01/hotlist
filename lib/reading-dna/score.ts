/**
 * READING DNA — Compatibility Scoring
 *
 * Scores books against a user's DNA profile using dot products.
 * Sub-millisecond, no API calls.
 */

import type { DnaProfile } from "./compute";
import type { BookDetail } from "@/lib/types";

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

/**
 * Rerank hydrated BookDetail results by blending original order with DNA affinity.
 *
 * 30% DNA, 70% original ranking — conservative enough that a #1 result
 * won't drop to #25, but strong enough to promote DNA-aligned books.
 * Only useful for relevance sorts; callers should skip this for explicit
 * sorts (rating, spice, newest, buzz).
 */
export function reRankByDna(
  books: BookDetail[],
  profile: DnaProfile,
  dnaBlend: number = 0.3
): BookDetail[] {
  if (books.length <= 1) return books;

  const reranked = books.map((book, originalIndex) => {
    const vector: BookVector = {
      bookId: book.id,
      vector: Object.fromEntries(
        book.tropes.map((t) => [t.slug, 1.0])
      ),
      spiceLevel: book.compositeSpice?.score ?? null,
    };

    const dnaResult = scoreBook(profile, vector);

    // Normalize original position to 0–1 (first = 1.0, last = 0.0)
    const positionScore = 1.0 - originalIndex / books.length;

    return {
      book,
      blendedScore: (1 - dnaBlend) * positionScore + dnaBlend * dnaResult.score,
    };
  });

  reranked.sort((a, b) => b.blendedScore - a.blendedScore);
  return reranked.map((r) => r.book);
}
