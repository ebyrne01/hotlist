/**
 * Book Resolver — matches extracted book mentions to our Goodreads-canonical database.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { searchGoodreads } from "@/lib/books/goodreads-search";
import { getBookDetail } from "@/lib/books";
import { isJunkTitle } from "@/lib/books/romance-filter";
import type { BookDetail } from "@/lib/types";

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
      // Strategy 1: DB lookup (fast)
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

      // Strategy 2: Goodreads search for "[series name] book 1" (one query)
      let swapped = false;
      try {
        const searchQuery = `${book.seriesName} ${book.author ?? ""}`.trim();
        const grResults = await searchGoodreads(searchQuery);
        for (const gr of grResults.slice(0, 5)) {
          const grBook = await getBookDetail(gr.goodreadsId);
          if (grBook && grBook.seriesPosition === 1) {
            console.log(`[book-resolver] Goodreads swap "${book.title}" (Book ${book.seriesPosition}) → "${grBook.title}" (Book 1)`);
            corrected.push({ ...result, book: grBook });
            swapped = true;
            break;
          }
        }
      } catch (err) {
        console.warn(`[book-resolver] Goodreads Book 1 search failed for "${book.seriesName}":`, err);
      }
      if (swapped) continue;
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
  // Only search if the title is long enough to be meaningful (avoid matching
  // short strings like author first names against unrelated book titles)
  if (normalizedTitle.length >= 4) {
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
  // If we have an author, prefer rows with BOTH title + author overlap
  if (author) {
    const authorWords = author
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1);

    for (const row of rows) {
      const dbAuthor = ((row.author as string) ?? "").toLowerCase();
      const dbTitle = ((row.title as string) ?? "").toLowerCase();
      const hasAuthorMatch = authorWords.some((w) => dbAuthor.includes(w));
      // Verify the title is actually relevant (not just a substring coincidence)
      const titleRelevant =
        dbTitle === normalizedTitle ||
        dbTitle.startsWith(normalizedTitle) ||
        normalizedTitle.startsWith(dbTitle) ||
        // Allow ILIKE substring match only if titles are similar length (within 2x)
        (dbTitle.includes(normalizedTitle) && dbTitle.length <= normalizedTitle.length * 2);
      if (hasAuthorMatch && titleRelevant) {
        return row;
      }
    }

    // Fallback: author match alone, but only if the title ILIKE is a very close match
    for (const row of rows) {
      const dbAuthor = ((row.author as string) ?? "").toLowerCase();
      const dbTitle = ((row.title as string) ?? "").toLowerCase();
      const hasAuthorMatch = authorWords.some((w) => dbAuthor.includes(w));
      if (hasAuthorMatch && (dbTitle === normalizedTitle || dbTitle.startsWith(normalizedTitle))) {
        return row;
      }
    }
  }

  // No author match — accept first row only if title is a very strong match
  const first = rows[0];
  const dbTitle = ((first.title as string) ?? "").toLowerCase();
  if (
    dbTitle === normalizedTitle ||
    // Only accept prefix match if the DB title isn't much longer (avoid "Mallory" matching "Mallory, Mallory: the revenge...")
    (dbTitle.startsWith(normalizedTitle) && dbTitle.length <= normalizedTitle.length * 1.5) ||
    (normalizedTitle.startsWith(dbTitle) && normalizedTitle.length <= dbTitle.length * 1.5)
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
  // Use both ILIKE (exact) and fuzzy trigram search to handle typos like "Karadoc" vs "Karadok"
  const supabase = getAdminClient();

  // 1a: Exact ILIKE match
  const { data: seriesMatches } = await supabase
    .from("books")
    .select("*")
    .ilike("series_name", `%${cleanedTitle}%`)
    .eq("series_position", 1)
    .limit(3);

  // 1b: Fuzzy trigram match on series_name (handles spelling variations)
  const { data: fuzzySeriesMatches } = await supabase.rpc("search_books_fuzzy", {
    search_title: cleanedTitle,
    search_author: author,
    match_limit: 5,
  });

  // Combine: exact ILIKE matches first, then fuzzy matches that are Book 1
  const allSeriesMatches = [...(seriesMatches ?? [])];
  if (fuzzySeriesMatches) {
    for (const fm of fuzzySeriesMatches) {
      // Only add fuzzy matches that look like they match the series
      const fmSeriesName = ((fm as Record<string, unknown>).series_name as string ?? "").toLowerCase();
      const fmPosition = (fm as Record<string, unknown>).series_position as number;
      if (fmPosition === 1 && fmSeriesName) {
        // Check if the series name is similar to what we're looking for
        const cleanedLower = cleanedTitle.toLowerCase();
        const seriesWords = cleanedLower.split(/\s+/).filter((w: string) => w.length > 2);
        const matchesEnough = seriesWords.some((w: string) => fmSeriesName.includes(w));
        if (matchesEnough && !allSeriesMatches.some((m) => (m as Record<string, unknown>).id === fm.id)) {
          allSeriesMatches.push(fm as Record<string, unknown>);
        }
      }
    }
  }

  if (allSeriesMatches.length > 0) {
    // If we have an author, prefer matching author
    if (author) {
      const authorWords = author.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
      for (const row of allSeriesMatches) {
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
    const book = await hydrateBookDetail(supabase, allSeriesMatches[0] as Record<string, unknown>);
    if (book) {
      console.log(`[book-resolver] DB series match (no author) for "${seriesTitle}": "${book.title}"`);
      return book;
    }
  }

  // ── Strategy 2: Single Goodreads search (avoid multiple slow queries) ──
  const searchQuery = author ? `${cleanedTitle} ${author}` : cleanedTitle;
  const results = await searchGoodreads(searchQuery);

  for (const result of results.slice(0, 5)) {
    const bookDetail = await getBookDetail(result.goodreadsId);
    if (!bookDetail) continue;

    if (bookDetail.seriesPosition === 1) {
      console.log(`[book-resolver] Goodreads Book 1 for "${seriesTitle}": "${bookDetail.title}"`);
      return bookDetail;
    }
  }

  // Accept first result with matching author if no explicit Book 1
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
