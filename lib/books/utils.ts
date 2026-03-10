import type { BookDetail } from "@/lib/types";
import { isJunkTitle } from "@/lib/books/romance-filter";

/**
 * Normalize a title for deduplication.
 * Strips subtitles, edition markers, series info, and foreign language suffixes
 * so "Iron Flame", "Iron Flame (Wing and Claw Collection)", and
 * "Onyx Storm - Edizione italiana" all collapse to their base title.
 */
export function normalizeTitle(title: string): string {
  return title
    .replace(/\s*[\(\[].*/g, "")
    .replace(/\s*[-–—:,].*/g, "")
    .replace(/\s+by\s+.*/i, "")
    .replace(/\bsigned\b/i, "")
    .replace(/\bedition\b/i, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/**
 * Deduplicate books by ID fields and normalized title+author.
 * When duplicates exist, keeps the best English edition with the most reviews.
 */
export function deduplicateBooks(books: BookDetail[]): BookDetail[] {
  const seen = new Map<string, BookDetail>();

  // First pass: collect exact ID matches
  const idSeen = new Set<string>();

  for (const book of books) {
    // Check exact ID duplicates first
    const ids = [
      book.goodreadsId,
      book.isbn,
      book.isbn13,
      book.googleBooksId,
    ].filter(Boolean) as string[];

    if (ids.some((id) => idSeen.has(id))) continue;
    ids.forEach((id) => idSeen.add(id));

    // Then check normalized title+author
    const key = `${normalizeTitle(book.title)}::${book.author.toLowerCase().trim()}`;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, book);
      continue;
    }

    // Prefer the better edition
    const existingReviews = existing.ratings.reduce((sum, r) => sum + (r.ratingCount ?? 0), 0);
    const bookReviews = book.ratings.reduce((sum, r) => sum + (r.ratingCount ?? 0), 0);
    const existingNonAscii = /[^\x00-\x7F]/.test(existing.title);
    const bookNonAscii = /[^\x00-\x7F]/.test(book.title);

    if (existingNonAscii && !bookNonAscii) {
      seen.set(key, book);
    } else if (!existingNonAscii && bookNonAscii) {
      // keep existing English edition
    } else if (bookReviews > existingReviews) {
      seen.set(key, book);
    } else if (bookReviews === existingReviews && existing.title.length > book.title.length) {
      seen.set(key, book);
    }
  }

  return Array.from(seen.values());
}

/**
 * Validates that a book meets minimum quality requirements for storage.
 * Prevents junk from Google Books API from polluting the database.
 */
export function isValidBookForStorage(book: {
  title: string;
  author: string;
  goodreadsId?: string | null;
}): boolean {
  // Must have a real Goodreads ID (not a placeholder)
  if (!book.goodreadsId || book.goodreadsId.startsWith("unknown-")) return false;

  // Must not match junk title patterns
  if (isJunkTitle(book.title)) return false;

  // Must have a real author
  if (!book.author || book.author === "Unknown Author") return false;

  return true;
}
