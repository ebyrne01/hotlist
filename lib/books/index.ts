/**
 * BOOK SERVICE — Single import point for all book operations.
 *
 * DATA FLOW FOR SEARCH:
 * 1. Check Supabase cache (instant)
 * 2. If cache miss: search Goodreads
 * 3. Filter results to romance books only (isRomanceBook check)
 * 4. Save Goodreads results to Supabase cache
 * 5. Trigger background metadata enrichment (Google Books / Open Library)
 * 6. Trigger background ratings scraping (Goodreads rating, Amazon rating)
 * 7. Trigger background spice inference (Goodreads shelf inference)
 * 8. Return results immediately from step 4 — don't wait for steps 5-7
 *
 * DATA FLOW FOR BOOK DETAIL:
 * 1. Look up by goodreads_id (or slug, which embeds goodreads_id)
 * 2. Return full record including ratings, spice, tropes
 * 3. If ratings are stale (>24h): trigger background re-scrape
 * 4. If ai_synopsis is null: trigger background synopsis generation
 *
 * DATA FLOW FOR HOMEPAGE ROWS:
 * - "What's Hot": NYT API → resolve each title to Goodreads ID → return Supabase records
 * - "New Releases": Google Books new releases in romance → filter → return
 * - Trope rows: Supabase query by trope tag
 */

import { getAdminClient } from "@/lib/supabase/admin";
import type { BookDetail } from "@/lib/types";
import {
  searchGoodreads,
  getGoodreadsBookById,
  extractGoodreadsIdFromSlug,
} from "./goodreads-search";
import { searchGoogleBooks } from "./google-books";
import {
  getBookFromCache,
  getBookByGoodreadsId,
  getBookBySlug,
  saveGoodreadsBookToCache,
  saveBookToCache,
  searchBooksInCache,
  mapDbBook,
} from "./cache";
import { generateSynopsis } from "./ai-synopsis";
import { scheduleEnrichment } from "@/lib/scraping";
import { scheduleMetadataEnrichment } from "./metadata-enrichment";
import { isJunkTitle } from "./romance-filter";
import { deduplicateBooks } from "./utils";
import { scheduleAuthorCrawl } from "./author-crawl";

// ── Search ────────────────────────────────────────────

/**
 * Search for books. Returns romance-only results.
 * Combines Supabase cache + Goodreads search.
 */
export async function findBook(query: string): Promise<BookDetail[]> {
  // 1. Check cache first (fast — local DB query)
  const cached = await searchBooksInCache(query);
  const filteredCache = cached.filter((b) => !isJunkTitle(b.title));

  // 2. If cache has results, return them — but check if this looks like an author search
  //    with sparse results that would benefit from a foreground Goodreads search.
  if (filteredCache.length > 0) {
    const lowerQuery = query.trim().toLowerCase();
    const authorMatches = filteredCache.filter(
      (b) => b.author.toLowerCase().includes(lowerQuery) ||
        lowerQuery.includes(b.author.toLowerCase().split(" ").pop() ?? "")
    );
    const isAuthorSearch =
      authorMatches.length > 0 &&
      authorMatches.length >= filteredCache.length * 0.5;

    // If it looks like an author search with fewer than 8 results,
    // search Goodreads in the foreground to discover more books by this author
    if (isAuthorSearch && filteredCache.length < 8) {
      try {
        const goodreadsResults = await withTimeout(searchGoodreads(query), 10_000);
        const newBooks = await foregroundSaveNewResults(goodreadsResults, filteredCache);
        const merged = deduplicateBooks([...filteredCache, ...newBooks]);
        return merged;
      } catch {
        // Goodreads search failed — return what we have from cache
        return filteredCache;
      }
    }

    // For non-author queries or well-populated caches, background search is fine
    backgroundGoodreadsSearch(query).catch(() => {});
    return deduplicateBooks(filteredCache);
  }

  // 3. No cache results — search Goodreads with a 10s timeout
  //    This is the "slow path" for books we've never seen before.
  try {
    const goodreadsResults = await withTimeout(searchGoodreads(query), 10_000);

    if (goodreadsResults.length > 0) {
      const saved: BookDetail[] = [];

      // Only fetch details for the first 3 results to stay fast
      for (const result of goodreadsResults.slice(0, 3)) {
        if (isJunkTitle(result.title)) continue;

        const detail = await withTimeout(getGoodreadsBookById(result.goodreadsId), 5_000).catch(() => null);
        if (!detail) continue;

        const book = await saveGoodreadsBookToCache({
          title: detail.title,
          author: detail.author,
          goodreadsId: detail.goodreadsId,
          goodreadsUrl: detail.goodreadsUrl,
          coverUrl: detail.coverUrl,
          description: detail.description,
          seriesName: detail.seriesName,
          seriesPosition: detail.seriesPosition,
          publishedYear: detail.publishedYear,
          pageCount: detail.pageCount,
          genres: detail.genres,
        });

        if (book) {
          saved.push({ ...book, ratings: [], spice: [], tropes: [] });
          scheduleMetadataEnrichment(book.id, book.title, book.author, book.isbn);
          scheduleEnrichment(book.id, book.title, book.author, book.isbn);
          scheduleAuthorCrawl(book.goodreadsId, book.author);
        }
      }

      if (saved.length > 0) {
        // Save remaining results in background (beyond the first 3)
        if (goodreadsResults.length > 3) {
          backgroundSaveGoodreadsResults(goodreadsResults.slice(3)).catch(() => {});
        }
        return deduplicateBooks(saved);
      }
    }
  } catch {
    console.log("[findBook] Goodreads search timed out for:", query);
  }

  // 4. Fallback: Google Books (for books Goodreads doesn't have)
  try {
    const googleResults = await withTimeout(searchGoogleBooks(query), 5_000);
    const fallbackSaved: BookDetail[] = [];

    for (const bookData of googleResults) {
      if (isJunkTitle(bookData.title)) continue;
      if (!bookData.goodreadsId || bookData.goodreadsId.startsWith("unknown-")) continue;

      const book = await saveBookToCache(bookData);
      if (book) {
        fallbackSaved.push({ ...book, ratings: [], spice: [], tropes: [] });
        scheduleEnrichment(book.id, book.title, book.author, book.isbn);
      }
    }

    return deduplicateBooks(fallbackSaved);
  } catch {
    return [];
  }
}

// ── Helpers for search performance ───────────────────

/** Wraps a promise with a timeout. Rejects if the promise doesn't resolve in time. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise
      .then((val) => { clearTimeout(timer); resolve(val); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

/** Search Goodreads in the background and save any new books to cache for future searches. */
async function backgroundGoodreadsSearch(query: string): Promise<void> {
  try {
    const results = await searchGoodreads(query);
    for (const result of results.slice(0, 5)) {
      if (isJunkTitle(result.title)) continue;
      const detail = await getGoodreadsBookById(result.goodreadsId).catch(() => null);
      if (!detail) continue;
      const book = await saveGoodreadsBookToCache({
        title: detail.title,
        author: detail.author,
        goodreadsId: detail.goodreadsId,
        goodreadsUrl: detail.goodreadsUrl,
        coverUrl: detail.coverUrl,
        description: detail.description,
        seriesName: detail.seriesName,
        seriesPosition: detail.seriesPosition,
        publishedYear: detail.publishedYear,
        pageCount: detail.pageCount,
        genres: detail.genres,
      });
      if (book) {
        scheduleMetadataEnrichment(book.id, book.title, book.author, book.isbn);
        scheduleEnrichment(book.id, book.title, book.author, book.isbn);
      }
    }
  } catch {
    // Background — swallow errors
  }
}

/** Save remaining Goodreads results in background after returning the first batch. */
async function backgroundSaveGoodreadsResults(results: Awaited<ReturnType<typeof searchGoodreads>>): Promise<void> {
  for (const result of results) {
    if (isJunkTitle(result.title)) continue;
    const detail = await getGoodreadsBookById(result.goodreadsId).catch(() => null);
    if (!detail) continue;
    const book = await saveGoodreadsBookToCache({
      title: detail.title,
      author: detail.author,
      goodreadsId: detail.goodreadsId,
      goodreadsUrl: detail.goodreadsUrl,
      coverUrl: detail.coverUrl,
      description: detail.description,
      seriesName: detail.seriesName,
      seriesPosition: detail.seriesPosition,
      publishedYear: detail.publishedYear,
      pageCount: detail.pageCount,
      genres: detail.genres,
    });
    if (book) {
      scheduleMetadataEnrichment(book.id, book.title, book.author, book.isbn);
      scheduleEnrichment(book.id, book.title, book.author, book.isbn);
    }
  }
}

/**
 * Save new Goodreads results not already in the cache (foreground, for author searches).
 * Only processes books not already present in existingBooks.
 */
async function foregroundSaveNewResults(
  goodreadsResults: Awaited<ReturnType<typeof searchGoodreads>>,
  existingBooks: BookDetail[]
): Promise<BookDetail[]> {
  const existingIds = new Set(existingBooks.map((b) => b.goodreadsId));
  const newBooks: BookDetail[] = [];

  for (const result of goodreadsResults.slice(0, 8)) {
    if (existingIds.has(result.goodreadsId)) continue;
    if (isJunkTitle(result.title)) continue;

    const detail = await withTimeout(
      getGoodreadsBookById(result.goodreadsId),
      5_000
    ).catch(() => null);
    if (!detail) continue;

    const book = await saveGoodreadsBookToCache({
      title: detail.title,
      author: detail.author,
      goodreadsId: detail.goodreadsId,
      goodreadsUrl: detail.goodreadsUrl,
      coverUrl: detail.coverUrl,
      description: detail.description,
      seriesName: detail.seriesName,
      seriesPosition: detail.seriesPosition,
      publishedYear: detail.publishedYear,
      pageCount: detail.pageCount,
      genres: detail.genres,
    });

    if (book) {
      newBooks.push({ ...book, ratings: [], spice: [], tropes: [] });
      scheduleMetadataEnrichment(book.id, book.title, book.author, book.isbn);
      scheduleEnrichment(book.id, book.title, book.author, book.isbn);
    }
  }

  return newBooks;
}

// deduplicateBooks imported from ./utils — deduplicates by ID fields + normalized title+author

// ── Book detail ───────────────────────────────────────

/**
 * Get a single book with full detail.
 * identifier can be: goodreads_id, slug, or isbn
 */
export async function getBookDetail(identifier: string): Promise<BookDetail | null> {
  // Try slug first (most common for URLs)
  const goodreadsIdFromSlug = extractGoodreadsIdFromSlug(identifier);
  let detail: BookDetail | null = null;

  if (goodreadsIdFromSlug) {
    detail = await getBookBySlug(identifier);
    if (!detail) {
      detail = await getBookByGoodreadsId(goodreadsIdFromSlug);
    }
  }

  // Try other identifiers
  if (!detail) {
    detail = await getBookFromCache(identifier);
  }

  // If still not found, try fetching from Goodreads
  if (!detail) {
    // Check if identifier looks like a Goodreads ID (numeric)
    if (/^\d+$/.test(identifier)) {
      const grDetail = await getGoodreadsBookById(identifier);
      if (grDetail) {
        const book = await saveGoodreadsBookToCache({
          title: grDetail.title,
          author: grDetail.author,
          goodreadsId: grDetail.goodreadsId,
          goodreadsUrl: grDetail.goodreadsUrl,
          coverUrl: grDetail.coverUrl,
          description: grDetail.description,
          seriesName: grDetail.seriesName,
          seriesPosition: grDetail.seriesPosition,
          publishedYear: grDetail.publishedYear,
          pageCount: grDetail.pageCount,
          genres: grDetail.genres,
        });
        if (book) {
          detail = { ...book, ratings: [], spice: [], tropes: [] };
          scheduleAuthorCrawl(book.goodreadsId, book.author);
        }
      }
    }
  }

  if (!detail) return null;

  // Generate AI synopsis if we have a real description but no synopsis
  // Skip junk descriptions (e.g. "1" from bad Goodreads editions)
  if (detail.description && detail.description.length >= 20 && !detail.aiSynopsis) {
    const synopsis = await generateSynopsis({
      id: detail.id,
      title: detail.title,
      author: detail.author,
      description: detail.description,
      aiSynopsis: detail.aiSynopsis,
      tropes: detail.tropes.map((t) => t.name),
    });
    if (synopsis) {
      detail.aiSynopsis = synopsis;
    }
  }

  // Schedule background enrichment if ratings are missing or stale
  const needsEnrichment =
    detail.ratings.length === 0 ||
    (detail.dataRefreshedAt &&
      Date.now() - new Date(detail.dataRefreshedAt).getTime() > 24 * 60 * 60 * 1000);

  if (needsEnrichment) {
    scheduleEnrichment(detail.id, detail.title, detail.author, detail.isbn);
    scheduleMetadataEnrichment(detail.id, detail.title, detail.author, detail.isbn);
  }

  return detail;
}

// ── Slug-based lookup ─────────────────────────────────

export { getBookBySlug } from "./cache";
export { generateBookSlug, extractGoodreadsIdFromSlug } from "./goodreads-search";

// ── Trope-based queries ──────────────────────────────

/**
 * Get books tagged with a specific trope.
 */
export async function getBooksByTrope(
  tropeSlug: string,
  options?: {
    sortBy?: "rating" | "spice" | "newest";
    minRating?: number;
    maxSpice?: number;
    minSpice?: number;
    limit?: number;
    offset?: number;
  }
): Promise<{ books: BookDetail[]; total: number }> {
  const supabase = getAdminClient();
  const { limit = 20, offset = 0 } = options ?? {};

  // Find the trope
  const { data: trope } = await supabase
    .from("tropes")
    .select("id")
    .eq("slug", tropeSlug)
    .single();

  if (!trope) return { books: [], total: 0 };

  // Get book IDs tagged with this trope
  const { data: bookTropes, count } = await supabase
    .from("book_tropes")
    .select("book_id", { count: "exact" })
    .eq("trope_id", trope.id);

  if (!bookTropes || bookTropes.length === 0) return { books: [], total: 0 };

  const bookIds = bookTropes.map((bt) => bt.book_id);

  // Fetch books
  const query = supabase
    .from("books")
    .select("*")
    .in("id", bookIds)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data: books } = await query;
  if (!books || books.length === 0) return { books: [], total: count ?? 0 };

  // Batch hydrate
  const ids = books.map((b) => b.id);
  const [ratingsRes, spiceRes, tropesRes] = await Promise.all([
    supabase.from("book_ratings").select("*").in("book_id", ids),
    supabase.from("book_spice").select("*").in("book_id", ids),
    supabase
      .from("book_tropes")
      .select("book_id, trope_id, tropes(id, slug, name, description)")
      .in("book_id", ids),
  ]);

  // Build lookup maps
  const ratingsMap = new Map<string, BookDetail["ratings"]>();
  for (const r of ratingsRes.data ?? []) {
    const list = ratingsMap.get(r.book_id) ?? [];
    list.push({
      source: r.source,
      rating: r.rating ? parseFloat(r.rating) : null,
      ratingCount: r.rating_count,
    });
    ratingsMap.set(r.book_id, list);
  }

  const spiceMap = new Map<string, BookDetail["spice"]>();
  for (const s of spiceRes.data ?? []) {
    const list = spiceMap.get(s.book_id) ?? [];
    list.push({
      source: s.source,
      spiceLevel: s.spice_level,
      ratingCount: s.rating_count,
    });
    spiceMap.set(s.book_id, list);
  }

  const tropeMap = new Map<string, BookDetail["tropes"]>();
  for (const bt of (tropesRes.data ?? []) as Record<string, unknown>[]) {
    const t = bt.tropes as Record<string, unknown> | null;
    if (!t) continue;
    const bookId = bt.book_id as string;
    const list = tropeMap.get(bookId) ?? [];
    list.push({
      id: t.id as string,
      slug: t.slug as string,
      name: t.name as string,
      description: (t.description as string) ?? null,
    });
    tropeMap.set(bookId, list);
  }

  const details: BookDetail[] = books.map((book) => {
    const mapped = mapDbBook(book);
    return {
      ...mapped,
      ratings: ratingsMap.get(book.id) ?? [],
      spice: spiceMap.get(book.id) ?? [],
      tropes: tropeMap.get(book.id) ?? [],
    };
  });

  // Apply post-fetch filters
  let filtered = details;
  if (options?.minRating) {
    filtered = filtered.filter((b) => {
      const rated = b.ratings.filter((r) => r.rating !== null);
      if (rated.length === 0) return true; // don't filter out unrated books
      const avg = rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length;
      return avg >= (options.minRating ?? 0);
    });
  }
  if (options?.minSpice) {
    filtered = filtered.filter((b) => {
      const max = b.spice.reduce((m, s) => Math.max(m, s.spiceLevel), 0);
      return max >= (options.minSpice ?? 0);
    });
  }
  if (options?.maxSpice) {
    filtered = filtered.filter((b) => {
      const max = b.spice.reduce((m, s) => Math.max(m, s.spiceLevel), 0);
      return max <= (options.maxSpice ?? 5);
    });
  }

  return { books: filtered, total: count ?? 0 };
}
