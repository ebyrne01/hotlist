/**
 * NYT BOOKS API — Discovery layer only.
 *
 * The NYT API is NOT a book identity source.
 * It tells us what's popular, but we always resolve NYT titles
 * to Goodreads IDs before storing or displaying them.
 *
 * Lists we use:
 * - 'hardcover-fiction' — captures major romance/fantasy releases
 * - 'mass-market-paperback' — captures romance paperbacks
 * - 'trade-fiction-paperback' — captures literary and upmarket romance
 *
 * Flow:
 * 1. Fetch lists from NYT API
 * 2. Combine and deduplicate by title+author
 * 3. For each title: resolve to Goodreads ID
 * 4. Filter: isRomanceBook must return true
 * 5. Store in nyt_trending + homepage_cache
 * 6. Return hydrated Supabase records
 */

import { getAdminClient } from "@/lib/supabase/admin";
import {
  resolveToGoodreadsId,
  getGoodreadsBookById,
  isRomanceBook as isRomanceByGenres,
} from "./goodreads-search";
import { saveGoodreadsBookToCache, hydrateBookDetail } from "./cache";
import { scheduleEnrichment } from "@/lib/scraping";
import { scheduleMetadataEnrichment } from "./metadata-enrichment";
import { isJunkTitle, isKnownRomanceAuthor } from "./romance-filter";
import type { BookDetail } from "@/lib/types";

const CACHE_KEY = "nyt_bestseller_romance";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const NYT_LISTS = [
  "hardcover-fiction",
  "mass-market-paperback",
  "trade-fiction-paperback",
] as const;

interface NYTBook {
  title: string;
  author: string;
  primary_isbn13: string;
  primary_isbn10: string;
  publisher: string;
  description: string;
  book_image: string;
  rank: number;
  weeks_on_list: number;
}

interface NYTListResponse {
  status: string;
  results: {
    list_name: string;
    books: NYTBook[];
  };
}

/**
 * Fetch NYT bestseller lists, resolve to Goodreads IDs,
 * filter to romance/romantasy, and return hydrated BookDetails.
 */
export async function getNYTBestsellerRomance(): Promise<BookDetail[]> {
  const supabase = getAdminClient();

  // 1. Check cache first
  const cached = await getCachedBookIds(supabase);
  if (cached) {
    const books = await hydrateFromIds(supabase, cached);
    if (books.length > 0) return books;
  }

  // 2. Fetch fresh from NYT API
  const apiKey = process.env.NYT_BOOKS_API_KEY;
  if (!apiKey) {
    console.warn("[nyt] NYT_BOOKS_API_KEY not set — skipping NYT bestsellers");
    return [];
  }

  const allNytBooks: (NYTBook & { listName: string })[] = [];

  for (const listName of NYT_LISTS) {
    try {
      const url = `https://api.nytimes.com/svc/books/v3/lists/current/${listName}.json?api-key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[nyt] Failed to fetch ${listName}: ${res.status}`);
        continue;
      }
      const data: NYTListResponse = await res.json();
      for (const book of data.results?.books ?? []) {
        allNytBooks.push({ ...book, listName });
      }
      // Be polite to the API
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.warn(`[nyt] Error fetching ${listName}:`, err);
    }
  }

  if (allNytBooks.length === 0) return [];

  // 3. Deduplicate by title+author (case-insensitive)
  const seen = new Set<string>();
  const uniqueNyt: (NYTBook & { listName: string })[] = [];
  for (const book of allNytBooks) {
    const key = `${book.title.toLowerCase()}::${book.author.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueNyt.push(book);
  }

  // 4. Resolve each to Goodreads, filter to romance
  const bookIds: string[] = [];

  for (const nytBook of uniqueNyt) {
    if (isJunkTitle(nytBook.title)) continue;

    try {
      // Resolve to Goodreads ID
      const goodreadsId = await resolveToGoodreadsId(nytBook.title, nytBook.author);
      if (!goodreadsId) {
        console.log(`[nyt] Could not resolve "${nytBook.title}" to Goodreads — skipping`);
        continue;
      }

      // Check if already in our database
      const { data: existing } = await supabase
        .from("books")
        .select("id, genres")
        .eq("goodreads_id", goodreadsId)
        .single();

      if (existing) {
        // Already have this book — check if it's romance
        const genres = (existing.genres as string[]) ?? [];
        if (isRomanceByGenres(genres) || isKnownRomanceAuthor(nytBook.author)) {
          bookIds.push(existing.id);

          // Update nyt_trending
          await supabase.from("nyt_trending").upsert(
            {
              book_id: existing.id,
              list_name: nytBook.listName,
              rank: nytBook.rank,
              weeks_on_list: nytBook.weeks_on_list ?? 1,
              fetched_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
            },
            { onConflict: "book_id,list_name" }
          );
        }
        continue;
      }

      // Fetch full Goodreads detail
      const grDetail = await getGoodreadsBookById(goodreadsId);
      if (!grDetail) continue;

      // Check if it's romance via Goodreads genres
      if (!isRomanceByGenres(grDetail.genres) && !isKnownRomanceAuthor(nytBook.author)) {
        console.log(`[nyt] "${nytBook.title}" is not romance — skipping`);
        continue;
      }

      // Save to our database
      const saved = await saveGoodreadsBookToCache({
        title: grDetail.title,
        author: grDetail.author,
        goodreadsId: grDetail.goodreadsId,
        goodreadsUrl: grDetail.goodreadsUrl,
        coverUrl: nytBook.book_image || grDetail.coverUrl, // NYT cover is often higher quality
        description: grDetail.description,
        seriesName: grDetail.seriesName,
        seriesPosition: grDetail.seriesPosition,
        publishedYear: grDetail.publishedYear,
        pageCount: grDetail.pageCount,
        genres: grDetail.genres,
        isbn13: nytBook.primary_isbn13 || null,
        isbn: nytBook.primary_isbn10 || null,
      });

      if (saved) {
        bookIds.push(saved.id);

        // Store NYT rank
        await supabase.from("nyt_trending").upsert(
          {
            book_id: saved.id,
            list_name: nytBook.listName,
            rank: nytBook.rank,
            weeks_on_list: nytBook.weeks_on_list ?? 1,
            fetched_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
          },
          { onConflict: "book_id,list_name" }
        );

        // Background enrichment
        scheduleMetadataEnrichment(saved.id, saved.title, saved.author, saved.isbn);
        scheduleEnrichment(saved.id, saved.title, saved.author, saved.isbn);
      }
    } catch (err) {
      console.warn(`[nyt] Error processing "${nytBook.title}":`, err);
    }
  }

  // 5. Cache the ordered list of IDs
  await saveCachedBookIds(supabase, bookIds);

  // 6. Return hydrated records
  return hydrateFromIds(supabase, bookIds);
}

// ── Cache helpers ─────────────────────────────────────

async function getCachedBookIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<string[] | null> {
  const { data } = await supabase
    .from("homepage_cache")
    .select("book_ids, fetched_at")
    .eq("cache_key", CACHE_KEY)
    .single();

  if (!data) return null;

  const age = Date.now() - new Date(data.fetched_at).getTime();
  if (age > CACHE_TTL_MS) return null;

  return data.book_ids;
}

async function saveCachedBookIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  bookIds: string[]
): Promise<void> {
  await supabase.from("homepage_cache").upsert(
    {
      cache_key: CACHE_KEY,
      book_ids: bookIds,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "cache_key" }
  );
}

// ── Hydration ─────────────────────────────────────────

async function hydrateFromIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  bookIds: string[]
): Promise<BookDetail[]> {
  if (bookIds.length === 0) return [];

  const { data: books } = await supabase
    .from("books")
    .select("*")
    .in("id", bookIds)
    .not("cover_url", "is", null);

  if (!books || books.length === 0) return [];

  // Batch hydrate
  const results: BookDetail[] = [];
  for (const book of books as Record<string, unknown>[]) {
    const detail = await hydrateBookDetail(supabase, book);
    results.push(detail);
  }

  // Preserve order from bookIds
  const orderMap = new Map(bookIds.map((id, i) => [id, i]));
  results.sort((a, b) => (orderMap.get(a.id) ?? 99) - (orderMap.get(b.id) ?? 99));

  return results;
}
