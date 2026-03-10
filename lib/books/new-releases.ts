/**
 * NEW RELEASES — Google Books discovery for recent romance/romantasy.
 *
 * Queries Google Books with subject:romance ordered by newest,
 * deduplicates, filters to romance, and caches in Supabase.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { saveBookToCache, hydrateBookDetail } from "./cache";
import { scheduleEnrichment } from "@/lib/scraping";
import { isJunkTitle, isKnownRomanceAuthor, isRomanceByGenres } from "./romance-filter";
import type { BookDetail, BookData } from "@/lib/types";

const CACHE_KEY = "romance_new_releases";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const BASE_URL = "https://www.googleapis.com/books/v1/volumes";

const SEARCH_QUERIES = [
  "subject:romance",
  "subject:fantasy+romance",
  "subject:romantic+fiction",
] as const;

interface GoogleVolume {
  id: string;
  volumeInfo: {
    title?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    categories?: string[];
    industryIdentifiers?: { type: string; identifier: string }[];
    pageCount?: number;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
}

export async function getRomanceNewReleases(): Promise<BookDetail[]> {
  const supabase = getAdminClient();

  // 1. Check cache
  const cached = await getCachedBookIds(supabase);
  if (cached) {
    const books = await hydrateFromIds(supabase, cached);
    if (books.length > 0) return books;
  }

  // 2. Fetch from Google Books
  const allVolumes: GoogleVolume[] = [];
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;

  for (const query of SEARCH_QUERIES) {
    try {
      const params = new URLSearchParams({
        q: query,
        orderBy: "newest",
        maxResults: "20",
        printType: "books",
        langRestrict: "en",
      });
      if (apiKey) params.set("key", apiKey);

      const res = await fetch(`${BASE_URL}?${params}`);
      if (!res.ok) continue;

      const data = await res.json();
      allVolumes.push(...(data.items ?? []));
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.warn(`[new-releases] Error for "${query}":`, err);
    }
  }

  if (allVolumes.length === 0) return [];

  // 3. Deduplicate
  const seenIds = new Set<string>();
  const seenTitleAuthor = new Set<string>();
  const unique: GoogleVolume[] = [];

  for (const vol of allVolumes) {
    if (!vol.volumeInfo?.title) continue;
    if (seenIds.has(vol.id)) continue;
    seenIds.add(vol.id);

    const key = `${vol.volumeInfo.title.toLowerCase()}::${(vol.volumeInfo.authors?.[0] ?? "").toLowerCase()}`;
    if (seenTitleAuthor.has(key)) continue;
    seenTitleAuthor.add(key);

    unique.push(vol);
  }

  // 4. Filter to romance
  const romanceResults: BookData[] = [];

  for (const vol of unique) {
    const info = vol.volumeInfo;
    const title = info.title ?? "";
    const author = info.authors?.join(", ") ?? "";

    if (!title || !author || author === "Unknown Author") continue;
    if (isJunkTitle(title)) continue;
    if (!info.imageLinks?.thumbnail && !info.imageLinks?.smallThumbnail) continue;

    const categories = info.categories ?? [];
    const descLower = (info.description ?? "").toLowerCase();
    const romanceKeywords = ["romance", "love story", "romantic", "swoon", "forbidden love", "enemies to lovers"];

    const isRomance =
      isRomanceByGenres(categories) ||
      romanceKeywords.some((kw) => descLower.includes(kw)) ||
      isKnownRomanceAuthor(author);

    if (!isRomance) continue;

    const identifiers = info.industryIdentifiers ?? [];
    let coverUrl = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null;
    if (coverUrl) coverUrl = coverUrl.replace("http://", "https://");

    romanceResults.push({
      googleBooksId: vol.id,
      title,
      author,
      isbn: identifiers.find((i) => i.type === "ISBN_10")?.identifier ?? null,
      isbn13: identifiers.find((i) => i.type === "ISBN_13")?.identifier ?? null,
      coverUrl,
      pageCount: info.pageCount ?? null,
      publishedYear: info.publishedDate ? parseInt(info.publishedDate.substring(0, 4), 10) || null : null,
      publisher: info.publisher ?? null,
      description: info.description ?? null,
      genres: categories.map((c) => c.toLowerCase()),
    });
  }

  // 5. Sort newest first, take top 12
  romanceResults.sort((a, b) => (b.publishedYear ?? 0) - (a.publishedYear ?? 0));
  const top = romanceResults.slice(0, 12);

  // 6. Save and return
  const bookIds: string[] = [];
  for (const bookData of top) {
    const saved = await saveBookToCache(bookData);
    if (saved) {
      bookIds.push(saved.id);
      scheduleEnrichment(saved.id, saved.title, saved.author, saved.isbn);
    }
  }

  await saveCachedBookIds(supabase, bookIds);
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
    { cache_key: CACHE_KEY, book_ids: bookIds, fetched_at: new Date().toISOString() },
    { onConflict: "cache_key" }
  );
}

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

  const results: BookDetail[] = [];
  for (const book of books as Record<string, unknown>[]) {
    results.push(await hydrateBookDetail(supabase, book));
  }

  // Preserve order
  const orderMap = new Map(bookIds.map((id, i) => [id, i]));
  results.sort((a, b) => (orderMap.get(a.id) ?? 99) - (orderMap.get(b.id) ?? 99));

  // New releases just need a cover — they're too new for many Goodreads ratings
  return results.filter((book) => !!book.coverUrl);
}
