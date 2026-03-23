import type { BookDetail } from "@/lib/types";

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
 * Limit author representation in a curated list.
 * Iterates through books and skips any where the author already
 * has `maxPerAuthor` entries in the output.
 */
export function diversifyByAuthor(books: BookDetail[], maxPerAuthor = 2): BookDetail[] {
  const authorCounts = new Map<string, number>();
  const result: BookDetail[] = [];

  for (const book of books) {
    const key = book.author.toLowerCase().trim();
    const count = authorCounts.get(key) ?? 0;
    if (count >= maxPerAuthor) continue;
    authorCounts.set(key, count + 1);
    result.push(book);
  }

  return result;
}

/** Compilation / omnibus / box set patterns */
const COMPILATION_PATTERNS = [
  /books?\s+\d+\s*[-–&and]+\s*\d+/i,       // "Books 1 and 2", "Books 1-3"
  /\bcomplete\s+series\b/i,                   // "Complete Series"
  /\bbox\s*set\b/i,                            // "Box Set", "Boxed Set"
  /\bomnibus\b/i,                              // "Omnibus"
  /\bcollection\s*[:\b]/i,                     // "Collection:" or "Collection"
  /\b(?:duet|trilogy|quartet)\s*:/i,           // "Duet:", "Trilogy:"
  /\d+\s*book\s*(?:set|bundle|collection)/i,  // "2 Book Set", "8 Book Bundle"
  /\bebook\s*bundle\b/i,                       // "eBook Bundle"
];

/**
 * Detect compilation/omnibus editions by title.
 * Returns true for multi-book bundles that shouldn't appear in curated rows.
 */
export function isCompilationTitle(title: string): boolean {
  return COMPILATION_PATTERNS.some((pattern) => pattern.test(title));
}

/** YA / children's genres to exclude from spicy curated rows */
const YA_GENRES = new Set([
  "young-adult",
  "young adult",
  "ya",
  "teen",
  "children",
  "childrens",
  "children's",
  "middle-grade",
  "middle grade",
]);

/**
 * Check if a book has YA or children's genre tags.
 */
export function hasYAGenre(book: BookDetail): boolean {
  return book.genres.some((g) => YA_GENRES.has(g.toLowerCase()));
}
