/**
 * Book Resolver — matches extracted book mentions to our Goodreads-canonical database.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { resolveToGoodreadsId, searchGoodreads } from "@/lib/books/goodreads-search";
import { getBookDetail } from "@/lib/books";
import { searchGoogleBooks } from "@/lib/books/google-books";
import { isJunkTitle } from "@/lib/books/romance-filter";
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
 *
 * Pipeline:
 * 1. Pre-filter junk titles (box sets, omnibus editions, compilations)
 * 2. Resolve each book via cache → Goodreads multi-strategy search
 * 3. Post-resolution dedup (by goodreads_id, by title substring)
 */
export async function resolveExtractedBooks(
  extracted: ExtractedBook[]
): Promise<ResolvedBook[]> {
  // Step 1: Pre-filter junk titles (but keep descriptionOnly books — they're descriptions, not real titles)
  const filtered = extracted.filter((book) => {
    if (!book.descriptionOnly && isJunkTitle(book.title)) {
      console.log(`[book-resolver] Skipping junk title: "${book.title}"`);
      return false;
    }
    return true;
  });

  // Step 2: Resolve each book
  const results: ResolvedBook[] = [];
  for (const book of filtered) {
    try {
      // Description-only books: the "title" is a description, not a real title.
      // Don't try to resolve — it would match the wrong book.
      if (book.descriptionOnly) {
        console.log(`[book-resolver] Skipping description-only: "${book.title}"`);
        results.push({
          matched: false,
          rawTitle: book.title,
          rawAuthor: book.author,
          creatorSentiment: book.sentiment,
          creatorQuote: book.creatorQuote,
          confidence: book.confidence as "high" | "medium",
        });
        continue;
      }

      const resolved = await resolveOneBook(book);
      // Post-resolution junk check — the resolved title may be a box set
      if (resolved.matched && isJunkTitle(resolved.book.title)) {
        console.log(`[book-resolver] Resolved to junk title, skipping: "${resolved.book.title}"`);
        continue;
      }
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

  // Step 3: Prefer Book 1 — if we resolved to a later book in a series,
  // swap to Book 1 (BookTok creators typically recommend entry points)
  const corrected = await preferSeriesBook1(results);

  // Step 4: Post-resolution dedup
  return deduplicateResults(corrected);
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

  // Step 2: Resolve via Goodreads (fuzzy mode for Whisper typos)
  const goodreadsId = await resolveToGoodreadsId(
    extracted.title,
    extracted.author ?? "",
    { fuzzy: true }
  );

  if (goodreadsId) {
    const bookDetail = await getBookDetail(goodreadsId);
    if (bookDetail) {
      return { matched: true, book: bookDetail, ...base };
    }
  }

  // Step 3: Fallback — title-only search on Goodreads with author matching
  if (extracted.author) {
    const titleOnlyResults = await searchGoodreads(extracted.title);
    for (const result of titleOnlyResults.slice(0, 3)) {
      const authorLower = extracted.author.toLowerCase();
      const resultAuthorLower = result.author.toLowerCase();
      const authorWords = authorLower.split(/\s+/).filter((w) => w.length > 1);
      const hasAuthorMatch = authorWords.some((w) => resultAuthorLower.includes(w));
      if (hasAuthorMatch) {
        const bookDetail = await getBookDetail(result.goodreadsId);
        if (bookDetail) {
          return { matched: true, book: bookDetail, ...base };
        }
      }
    }
  }

  // Step 4: Series name search — if the title looks like a series name,
  // search for the series and try to find Book 1
  if (looksLikeSeriesName(extracted.title)) {
    console.log(`[book-resolver] Title looks like series name: "${extracted.title}", searching for Book 1`);
    const seriesBook = await resolveSeriesName(extracted.title, extracted.author);
    if (seriesBook) {
      return { matched: true, book: seriesBook, ...base };
    }
  }

  // Step 5: Unmatched
  return {
    matched: false,
    rawTitle: extracted.title,
    rawAuthor: extracted.author,
    ...base,
  };
}

/**
 * Post-resolution: if a resolved book is NOT Book 1 in its series,
 * try to find Book 1 and swap it in. BookTok creators almost always
 * recommend the series starting from Book 1, even if they show a later cover.
 */
async function preferSeriesBook1(results: ResolvedBook[]): Promise<ResolvedBook[]> {
  const { hydrateBookDetail } = await import("@/lib/books/cache");
  const supabase = getAdminClient();
  const corrected: ResolvedBook[] = [];

  for (const result of results) {
    if (!result.matched) {
      corrected.push(result);
      continue;
    }

    const book = result.book;
    // Only swap if: book has a series, is NOT Book 1, and we know the series name
    if (book.seriesName && book.seriesPosition && book.seriesPosition > 1) {
      // Try to find Book 1 in the same series in our DB
      const { data: book1Rows } = await supabase
        .from("books")
        .select("*")
        .ilike("series_name", book.seriesName)
        .eq("series_position", 1)
        .limit(1);

      if (book1Rows && book1Rows.length > 0) {
        const book1 = await hydrateBookDetail(supabase, book1Rows[0] as Record<string, unknown>);
        if (book1) {
          console.log(`[book-resolver] Swapping "${book.title}" (Book ${book.seriesPosition}) → "${book1.title}" (Book 1)`);
          corrected.push({ ...result, book: book1 });
          continue;
        }
      }

      // Book 1 not in our DB — try Goodreads
      const searchResults = await searchGoodreads(`${book.seriesName} book 1`);
      for (const sr of searchResults.slice(0, 3)) {
        const detail = await getBookDetail(sr.goodreadsId);
        if (detail && detail.seriesPosition === 1 && detail.seriesName === book.seriesName) {
          console.log(`[book-resolver] Goodreads swap "${book.title}" → "${detail.title}" (Book 1)`);
          corrected.push({ ...result, book: detail });
          continue;
        }
      }
    }

    corrected.push(result);
  }

  return corrected;
}

/** Normalize text for comparison: lowercase, strip punctuation, collapse spaces */
function normalizeForDedup(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^\w\s']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Post-resolution deduplication:
 * 1. By goodreads_id — keep the higher-confidence / first occurrence
 * 2. By title substring — if one resolved title contains another, keep the shorter (real) one
 */
function deduplicateResults(results: ResolvedBook[]): ResolvedBook[] {
  const seen = new Map<string, number>(); // goodreads_id → index in deduped
  const deduped: ResolvedBook[] = [];

  for (const result of results) {
    if (!result.matched) {
      deduped.push(result);
      continue;
    }

    const gid = result.book.goodreadsId ?? result.book.id;

    // Dedup by goodreads_id
    if (seen.has(gid)) {
      const existingIdx = seen.get(gid)!;
      const existing = deduped[existingIdx] as ResolvedBookMatched;
      // Keep the one with higher confidence, or the one with a creator quote
      if (
        result.confidence === "high" && existing.confidence !== "high" ||
        (result.creatorQuote && !existing.creatorQuote)
      ) {
        deduped[existingIdx] = result;
      }
      continue;
    }

    // Dedup by title substring — if a previously resolved book's title
    // is contained within this one (or vice versa), skip the longer one
    const normalizedTitle = normalizeForDedup(result.book.title);
    let isDuplicate = false;
    for (let i = 0; i < deduped.length; i++) {
      const existing = deduped[i];
      if (!existing.matched) continue;
      const existingTitle = normalizeForDedup(existing.book.title);
      if (
        normalizedTitle.includes(existingTitle) &&
        normalizedTitle !== existingTitle
      ) {
        // This title is longer (likely a box set variant) — skip it
        isDuplicate = true;
        break;
      }
      if (
        existingTitle.includes(normalizedTitle) &&
        existingTitle !== normalizedTitle
      ) {
        // Existing title is longer — replace it with this shorter one
        deduped[i] = result;
        seen.set(gid, i);
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seen.set(gid, deduped.length);
      deduped.push(result);
    }
  }

  return deduped;
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

  const filteredTitleMatches = (titleMatches ?? []).filter(
    (row) => !isJunkTitle(row.title as string)
  );

  if (filteredTitleMatches.length > 0) {
    const match = pickBestMatch(filteredTitleMatches, normalizedTitle, author);
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

/**
 * Detect if a title is actually a series name rather than a book title.
 * e.g., "Monsters of Faerie series", "Brides of Karadoc series", "Dragon Kin"
 */
function looksLikeSeriesName(title: string): boolean {
  const lower = title.toLowerCase();
  // Explicit "series" keyword
  if (/\bseries\b/.test(lower)) return true;
  // Explicit "trilogy", "saga", "chronicles"
  if (/\b(trilogy|saga|chronicles|collection)\b/.test(lower)) return true;
  return false;
}

/**
 * Try to resolve a series name to its first book.
 * Strategy: DB series_name search → Goodreads search → Google Books fallback.
 */
async function resolveSeriesName(
  seriesTitle: string,
  author: string | null
): Promise<BookDetail | null> {
  const cleanedTitle = seriesTitle
    .replace(/\b(series|trilogy|saga|chronicles|collection)\b/gi, "")
    .trim();

  const { hydrateBookDetail } = await import("@/lib/books/cache");

  // ── Strategy 1: Search our DB by series_name column (fastest, most reliable) ──
  const supabase = getAdminClient();
  const { data: seriesMatches } = await supabase
    .from("books")
    .select("*")
    .ilike("series_name", `%${cleanedTitle}%`)
    .eq("series_position", 1)
    .limit(3);

  if (seriesMatches && seriesMatches.length > 0) {
    // If we have an author, prefer matching author
    if (author) {
      const authorWords = author.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
      for (const row of seriesMatches) {
        const dbAuthor = ((row.author as string) ?? "").toLowerCase();
        if (authorWords.some((w) => dbAuthor.includes(w))) {
          const book = await hydrateBookDetail(supabase, row as Record<string, unknown>);
          if (book) {
            console.log(`[book-resolver] DB series match for "${seriesTitle}": "${book.title}"`);
            return book;
          }
        }
      }
    }
    // No author or no author match — use first Book 1 result
    const book = await hydrateBookDetail(supabase, seriesMatches[0] as Record<string, unknown>);
    if (book) {
      console.log(`[book-resolver] DB series match (no author) for "${seriesTitle}": "${book.title}"`);
      return book;
    }
  }

  // ── Strategy 2: Goodreads search with multiple queries ──
  const searchQueries = [
    author ? `${cleanedTitle} ${author}` : cleanedTitle,
    cleanedTitle,
    `${cleanedTitle} book 1`,
  ];

  for (const searchQuery of searchQueries) {
    const results = await searchGoodreads(searchQuery);

    for (const result of results.slice(0, 5)) {
      const bookDetail = await getBookDetail(result.goodreadsId);
      if (!bookDetail) continue;

      if (bookDetail.seriesPosition === 1) {
        console.log(`[book-resolver] Goodreads Book 1 for "${seriesTitle}": "${bookDetail.title}"`);
        return bookDetail;
      }
    }

    // Accept first result with matching author if no Book 1 found
    if (author && results.length > 0) {
      const authorWords = author.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
      for (const result of results.slice(0, 3)) {
        if (authorWords.some((w) => result.author.toLowerCase().includes(w))) {
          const bookDetail = await getBookDetail(result.goodreadsId);
          if (bookDetail) {
            console.log(`[book-resolver] Goodreads author-match for "${seriesTitle}": "${bookDetail.title}"`);
            return bookDetail;
          }
        }
      }
    }
  }

  // ── Strategy 3: Google Books fallback ──
  try {
    const googleQuery = author ? `${cleanedTitle} ${author}` : cleanedTitle;
    const googleResults = await searchGoogleBooks(googleQuery);
    if (googleResults.length > 0) {
      const firstResult = googleResults[0];
      const goodreadsId = await resolveToGoodreadsId(
        firstResult.title,
        firstResult.author,
        { fuzzy: true }
      );
      if (goodreadsId) {
        const bookDetail = await getBookDetail(goodreadsId);
        if (bookDetail) {
          console.log(`[book-resolver] Google Books for "${seriesTitle}": "${bookDetail.title}"`);
          return bookDetail;
        }
      }
    }
  } catch (err) {
    console.warn(`[book-resolver] Google Books fallback failed for "${seriesTitle}":`, err);
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
