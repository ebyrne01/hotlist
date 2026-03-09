/**
 * METADATA ENRICHMENT
 *
 * Given a book already identified via Goodreads, fetch supplementary
 * metadata from Google Books and Open Library.
 *
 * Fields we fill in (only if missing from Goodreads data):
 * - isbn / isbn13
 * - pageCount
 * - publisher
 * - publishedYear
 * - coverUrl (Google Books often has higher-res covers)
 *
 * We do NOT use this to get title, author, or rating —
 * those always come from Goodreads.
 */

import { createClient } from "@supabase/supabase-js";
import { searchGoogleBooks } from "./google-books";
import { getOpenLibraryByISBN } from "./open-library";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { fetch: (...args) => fetch(args[0], { ...args[1], cache: "no-store" }) } }
  );
}

interface SupplementaryMetadata {
  isbn?: string | null;
  isbn13?: string | null;
  pageCount?: number | null;
  publisher?: string | null;
  publishedYear?: number | null;
  coverUrl?: string | null;
  googleBooksId?: string | null;
}

/**
 * Look up a book on Google Books by title + author.
 * Returns only supplementary metadata fields.
 */
async function enrichFromGoogleBooks(
  title: string,
  author: string
): Promise<SupplementaryMetadata | null> {
  try {
    const results = await searchGoogleBooks(`${title} ${author}`);
    if (results.length === 0) return null;

    const top = results[0];
    return {
      isbn: top.isbn ?? null,
      isbn13: top.isbn13 ?? null,
      pageCount: top.pageCount ?? null,
      publisher: top.publisher ?? null,
      publishedYear: top.publishedYear ?? null,
      coverUrl: top.coverUrl ?? null,
      googleBooksId: top.googleBooksId ?? null,
    };
  } catch (err) {
    console.warn(`[enrichment] Google Books failed for "${title}":`, err);
    return null;
  }
}

/**
 * Look up a book on Open Library by ISBN.
 * Second fallback if Google Books misses page count / publisher.
 */
async function enrichFromOpenLibrary(
  isbn: string
): Promise<SupplementaryMetadata | null> {
  try {
    const book = await getOpenLibraryByISBN(isbn);
    if (!book) return null;

    return {
      isbn: book.isbn ?? null,
      isbn13: book.isbn13 ?? null,
      pageCount: book.pageCount ?? null,
      publisher: book.publisher ?? null,
      publishedYear: book.publishedYear ?? null,
      coverUrl: book.coverUrl ?? null,
    };
  } catch (err) {
    console.warn(`[enrichment] Open Library failed for ISBN ${isbn}:`, err);
    return null;
  }
}

/**
 * Master enrichment function. Call after saving a book from Goodreads.
 * Tries Google Books first, Open Library second.
 * Updates the Supabase book record with any fields it finds.
 * Non-blocking — call without await so it doesn't slow down the user.
 */
export async function enrichBookMetadata(
  bookId: string,
  title: string,
  author: string,
  isbn?: string | null
): Promise<void> {
  const supabase = getAdminClient();

  // Get the current book record to see what's missing
  const { data: existing } = await supabase
    .from("books")
    .select("isbn, isbn13, page_count, publisher, published_year, cover_url, google_books_id")
    .eq("id", bookId)
    .single();

  if (!existing) return;

  const updates: Record<string, unknown> = {};

  // Try Google Books first
  const googleData = await enrichFromGoogleBooks(title, author);
  if (googleData) {
    if (!existing.isbn && googleData.isbn) updates.isbn = googleData.isbn;
    if (!existing.isbn13 && googleData.isbn13) updates.isbn13 = googleData.isbn13;
    if (!existing.page_count && googleData.pageCount) updates.page_count = googleData.pageCount;
    if (!existing.publisher && googleData.publisher) updates.publisher = googleData.publisher;
    if (!existing.published_year && googleData.publishedYear) updates.published_year = googleData.publishedYear;
    if (!existing.google_books_id && googleData.googleBooksId) updates.google_books_id = googleData.googleBooksId;
    // Only use Google cover if we have no cover at all
    if (!existing.cover_url && googleData.coverUrl) updates.cover_url = googleData.coverUrl;
  }

  // If we still need page count or publisher, try Open Library
  const isbnToLookup = (updates.isbn13 as string) ?? existing.isbn13 ?? (updates.isbn as string) ?? existing.isbn ?? isbn;
  if (isbnToLookup && (!existing.page_count && !updates.page_count || !existing.publisher && !updates.publisher)) {
    const olData = await enrichFromOpenLibrary(isbnToLookup);
    if (olData) {
      if (!existing.page_count && !updates.page_count && olData.pageCount) updates.page_count = olData.pageCount;
      if (!existing.publisher && !updates.publisher && olData.publisher) updates.publisher = olData.publisher;
      if (!existing.published_year && !updates.published_year && olData.publishedYear) updates.published_year = olData.publishedYear;
    }
  }

  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    await supabase.from("books").update(updates).eq("id", bookId);
    console.log(`[enrichment] Updated ${Object.keys(updates).length} fields for "${title}"`);
  }
}

/**
 * Fire-and-forget wrapper. Call this from book service code.
 */
export function scheduleMetadataEnrichment(
  bookId: string,
  title: string,
  author: string,
  isbn?: string | null
): void {
  enrichBookMetadata(bookId, title, author, isbn).catch((err) => {
    console.warn(`[enrichment] Background enrichment failed for "${title}":`, err);
  });
}
