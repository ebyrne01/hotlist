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

  // Step 2: Resolve via Goodreads search
  const goodreadsId = await resolveToGoodreadsId(
    extracted.title,
    extracted.author ?? ""
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
 * Search our Supabase books table for a fuzzy match on title + author.
 */
async function searchCache(
  title: string,
  author: string | null
): Promise<BookDetail | null> {
  const supabase = getAdminClient();

  // Try exact-ish title match first
  const normalizedTitle = title.toLowerCase().trim();
  const { data: titleMatches } = await supabase
    .from("books")
    .select("*")
    .ilike("title", `%${normalizedTitle}%`)
    .limit(5);

  if (!titleMatches || titleMatches.length === 0) return null;

  // If we have an author, filter by author name overlap
  if (author) {
    const authorWords = author
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1);

    for (const row of titleMatches) {
      const dbAuthor = (row.author as string).toLowerCase();
      const hasAuthorMatch = authorWords.some((w) => dbAuthor.includes(w));
      if (hasAuthorMatch) {
        // Import hydrateBookDetail to get full data
        const { hydrateBookDetail } = await import("@/lib/books/cache");
        return hydrateBookDetail(
          supabase,
          row as Record<string, unknown>
        );
      }
    }
  }

  // No author match or no author given — return first title match
  // only if title is a strong match
  const firstMatch = titleMatches[0];
  const dbTitle = (firstMatch.title as string).toLowerCase();
  if (
    dbTitle === normalizedTitle ||
    dbTitle.startsWith(normalizedTitle) ||
    normalizedTitle.startsWith(dbTitle)
  ) {
    const { hydrateBookDetail } = await import("@/lib/books/cache");
    return hydrateBookDetail(
      supabase,
      firstMatch as Record<string, unknown>
    );
  }

  return null;
}
