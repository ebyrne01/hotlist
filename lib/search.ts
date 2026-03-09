import type { BookDetail } from "@/lib/types";
import { searchBooksInCache } from "@/lib/books/cache";
import { searchGoogleBooks } from "@/lib/books/google-books";
import { saveBookToCache } from "@/lib/books/cache";

/**
 * Search books: checks Supabase cache first, then Google Books.
 * Merges and deduplicates results.
 */
export async function searchBooks(query: string): Promise<BookDetail[]> {
  // Run both searches in parallel
  const [cacheResults, googleResults] = await Promise.all([
    searchBooksInCache(query).catch(() => [] as BookDetail[]),
    searchGoogleBooks(query).catch(() => []),
  ]);

  // Save Google results to cache in background
  const googleSaved: BookDetail[] = [];
  for (const bookData of googleResults) {
    const book = await saveBookToCache(bookData);
    if (book) {
      googleSaved.push({ ...book, ratings: [], spice: [], tropes: [] });
    }
  }

  // Deduplicate: cache results first (richer data), then Google
  const seen = new Set<string>();
  const merged: BookDetail[] = [];

  for (const book of [...cacheResults, ...googleSaved]) {
    // Dedup by ISBN, google_books_id, or title+author
    const keys = [
      book.isbn,
      book.isbn13,
      book.googleBooksId,
      `${book.title.toLowerCase()}::${book.author.toLowerCase()}`,
    ].filter(Boolean) as string[];

    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    merged.push(book);
  }

  return merged;
}
