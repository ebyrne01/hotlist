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

import { createClient } from "@supabase/supabase-js";
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

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ── Search ────────────────────────────────────────────

/**
 * Search for books. Returns romance-only results.
 * Combines Supabase cache + Goodreads search.
 */
export async function findBook(query: string): Promise<BookDetail[]> {
  const lowerQuery = query.trim().toLowerCase();

  // 1. Check cache first
  const cached = await searchBooksInCache(query);
  const filteredCache = cached.filter((b) => !isJunkTitle(b.title));

  // If top result closely matches the query title, return cache results
  if (filteredCache.length > 0) {
    const topTitle = filteredCache[0].title.toLowerCase();
    const hasCloseMatch =
      topTitle === lowerQuery ||
      topTitle.startsWith(lowerQuery) ||
      topTitle.includes(lowerQuery) ||
      lowerQuery.split(/\s+/).every((w) => topTitle.includes(w));

    if (hasCloseMatch) {
      return filteredCache;
    }
  }

  // 2. Search Goodreads (canonical source) — cache had no close match
  const goodreadsResults = await searchGoodreads(query);

  if (goodreadsResults.length > 0) {
    const saved: BookDetail[] = [];

    for (const result of goodreadsResults) {
      if (isJunkTitle(result.title)) continue;

      // Get full detail from Goodreads for genre info
      const detail = await getGoodreadsBookById(result.goodreadsId);
      if (!detail) continue;

      // Save to Supabase cache
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

        // Background enrichment: metadata from Google Books, ratings from scrapers
        scheduleMetadataEnrichment(book.id, book.title, book.author, book.isbn);
        scheduleEnrichment(book.id, book.title, book.author, book.isbn);
      }
    }

    if (saved.length > 0) {
      // Merge with any non-duplicate cache results
      const savedIds = new Set(saved.map((b) => b.id));
      const extras = filteredCache.filter((b) => !savedIds.has(b.id));
      return [...saved, ...extras].slice(0, 15);
    }
  }

  // If we had cache results but no Goodreads results, return cache anyway
  if (filteredCache.length > 0) {
    return filteredCache;
  }

  // 3. Fallback: Google Books (for books Goodreads doesn't have)
  const googleResults = await searchGoogleBooks(query);
  const fallbackSaved: BookDetail[] = [];

  for (const bookData of googleResults) {
    if (isJunkTitle(bookData.title)) continue;

    const book = await saveBookToCache(bookData);
    if (book) {
      fallbackSaved.push({ ...book, ratings: [], spice: [], tropes: [] });
      scheduleEnrichment(book.id, book.title, book.author, book.isbn);
    }
  }

  return fallbackSaved;
}

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
