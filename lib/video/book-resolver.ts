/**
 * Book Resolver — matches extracted book mentions to our Goodreads-canonical database.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { resolveToGoodreadsId } from "@/lib/books/goodreads-search";
import { getBookDetail } from "@/lib/books";
import type { BookDetail } from "@/lib/types";
import type { ExtractedBook } from "./book-extractor";

export interface ResolvedBookMatched {
  matched: true;
  book: BookDetail;
  creatorSentiment: string;
  creatorQuote: string;
  confidence: "high" | "medium";
}

export interface ResolvedBookUnmatched {
  matched: false;
  rawTitle: string;
  rawAuthor: string | null;
  creatorSentiment: string;
  creatorQuote: string;
  confidence: "high" | "medium";
}

export type ResolvedBook = ResolvedBookMatched | ResolvedBookUnmatched;

/**
 * Resolve extracted book mentions to canonical database records.
 * For each extracted book:
 * 1. Search our Supabase cache (fuzzy title + author match)
 * 2. If not found, try resolveToGoodreadsId
 * 3. If resolved, fetch/create the full book record
 * 4. If not resolved, return as "unmatched"
 */
export async function resolveExtractedBooks(
  extracted: ExtractedBook[]
): Promise<ResolvedBook[]> {
  const results: ResolvedBook[] = [];

  for (const book of extracted) {
    try {
      const resolved = await resolveOneBook(book);
      results.push(resolved);
    } catch (err) {
      console.error(`[book-resolver] Failed to resolve "${book.title}":`, err);
      results.push({
        matched: false,
        rawTitle: book.title,
        rawAuthor: book.author,
        creatorSentiment: book.sentiment,
        creatorQuote: book.creatorQuote,
        confidence: book.confidence as "high" | "medium",
      });
    }
  }

  return results;
}

async function resolveOneBook(
  extracted: ExtractedBook
): Promise<ResolvedBook> {
  const base = {
    creatorSentiment: extracted.sentiment,
    creatorQuote: extracted.creatorQuote,
    confidence: extracted.confidence as "high" | "medium",
  };

  // Step 1: Search our Supabase cache first (fast, no external call)
  const cachedBook = await searchCache(extracted.title, extracted.author);
  if (cachedBook) {
    return { matched: true, book: cachedBook, ...base };
  }

  // Step 2: Resolve via Goodreads search (fuzzy mode for Whisper typos)
  const goodreadsId = await resolveToGoodreadsId(
    extracted.title,
    extracted.author ?? "",
    { fuzzy: true }
  );

  if (goodreadsId) {
    // Step 3: Fetch/create the full book record
    const bookDetail = await getBookDetail(goodreadsId);
    if (bookDetail) {
      return { matched: true, book: bookDetail, ...base };
    }
  }

  // Step 4: Unmatched
  return {
    matched: false,
    rawTitle: extracted.title,
    rawAuthor: extracted.author,
    ...base,
  };
}

/**
 * Search our Supabase books table for a match on title + author.
 * Uses a multi-strategy approach:
 * 1. Exact ILIKE match (fast path for clean transcriptions)
 * 2. Trigram similarity search (handles Whisper typos like "Alchemized"→"Alchemised")
 */
async function searchCache(
  title: string,
  author: string | null
): Promise<BookDetail | null> {
  const supabase = getAdminClient();
  const { hydrateBookDetail } = await import("@/lib/books/cache");
  const normalizedTitle = title.toLowerCase().trim();

  // ── Step 1: Exact ILIKE match (fast path) ──
  const { data: titleMatches } = await supabase
    .from("books")
    .select("*")
    .ilike("title", `%${normalizedTitle}%`)
    .limit(5);

  if (titleMatches && titleMatches.length > 0) {
    const match = pickBestMatch(titleMatches, normalizedTitle, author);
    if (match) {
      return hydrateBookDetail(supabase, match as Record<string, unknown>);
    }
  }

  // ── Step 2: Trigram similarity search (fuzzy, handles typos) ──
  const { data: fuzzyMatches } = await supabase.rpc("search_books_fuzzy", {
    search_title: title,
    search_author: author,
    match_limit: 5,
  });

  if (fuzzyMatches && fuzzyMatches.length > 0) {
    const best = pickBestFuzzyMatch(fuzzyMatches, author);
    if (best) {
      // Re-fetch full row by ID for hydration
      const { data: fullRow } = await supabase
        .from("books")
        .select("*")
        .eq("id", best.id)
        .single();
      if (fullRow) {
        return hydrateBookDetail(supabase, fullRow as Record<string, unknown>);
      }
    }
  }

  return null;
}

/** Pick the best match from ILIKE results using author overlap. */
function pickBestMatch(
  rows: Record<string, unknown>[],
  normalizedTitle: string,
  author: string | null
): Record<string, unknown> | null {
  // If we have an author, prefer rows with author overlap
  if (author) {
    const authorWords = author
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1);

    for (const row of rows) {
      const dbAuthor = (row.author as string).toLowerCase();
      if (authorWords.some((w) => dbAuthor.includes(w))) {
        return row;
      }
    }
  }

  // No author match — accept first row only if title is a strong match
  const first = rows[0];
  const dbTitle = (first.title as string).toLowerCase();
  if (
    dbTitle === normalizedTitle ||
    dbTitle.startsWith(normalizedTitle) ||
    normalizedTitle.startsWith(dbTitle)
  ) {
    return first;
  }

  return null;
}

/** Pick the best match from trigram fuzzy results. */
function pickBestFuzzyMatch(
  fuzzyMatches: { id: string; title: string; author: string; similarity_score: number }[],
  author: string | null
): { id: string; title: string; author: string; similarity_score: number } | null {
  if (fuzzyMatches.length === 0) return null;

  const best = fuzzyMatches[0];

  // If the best score is very strong (>= 0.6) and it's clearly the top candidate, accept it
  if (best.similarity_score >= 0.6) {
    const secondBest = fuzzyMatches[1];
    if (!secondBest || best.similarity_score - secondBest.similarity_score > 0.1) {
      return best;
    }
  }

  // If we have an author, use it as tiebreaker among candidates
  if (author) {
    const authorWords = author
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1);

    for (const match of fuzzyMatches) {
      const dbAuthor = match.author.toLowerCase();
      const hasAuthorMatch = authorWords.some((w) => dbAuthor.includes(w));
      if (hasAuthorMatch && match.similarity_score >= 0.3) {
        return match;
      }
    }
  }

  // Without author confirmation, only accept very high similarity
  if (best.similarity_score >= 0.6) {
    return best;
  }

  return null;
}
