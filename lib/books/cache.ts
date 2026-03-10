import { getAdminClient } from "@/lib/supabase/admin";
import type { Book, BookData, BookDetail, Rating, SpiceRating, Trope } from "@/lib/types";
import { generateBookSlug } from "./goodreads-search";
import { isJunkTitle } from "./romance-filter";

/** Returns null if the URL is a known placeholder image */
function cleanCoverUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.includes("no-cover") || url.includes("nophoto")) return null;
  return url;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Read from cache ──────────────────────────────────

export async function getBookFromCache(identifier: string): Promise<BookDetail | null> {
  const supabase = getAdminClient();

  // Try matching by goodreads_id, slug, google_books_id, isbn, isbn13
  const { data: book } = await supabase
    .from("books")
    .select("*")
    .or(
      `goodreads_id.eq.${identifier},slug.eq.${identifier},google_books_id.eq.${identifier},isbn.eq.${identifier},isbn13.eq.${identifier}`
    )
    .limit(1)
    .single();

  if (!book) return null;

  // Check freshness
  if (book.data_refreshed_at) {
    const age = Date.now() - new Date(book.data_refreshed_at).getTime();
    if (age > CACHE_TTL_MS) return null; // stale
  } else {
    return null; // never fetched
  }

  return hydrateBookDetail(supabase, book);
}

export async function getBookByGoodreadsId(goodreadsId: string): Promise<BookDetail | null> {
  const supabase = getAdminClient();
  const { data: book } = await supabase
    .from("books")
    .select("*")
    .eq("goodreads_id", goodreadsId)
    .single();

  if (!book) return null;
  return hydrateBookDetail(supabase, book);
}

export async function getBookBySlug(slug: string): Promise<BookDetail | null> {
  const supabase = getAdminClient();
  const { data: book } = await supabase
    .from("books")
    .select("*")
    .eq("slug", slug)
    .single();

  if (!book) return null;
  return hydrateBookDetail(supabase, book);
}

export async function searchBooksInCache(query: string): Promise<BookDetail[]> {
  const supabase = getAdminClient();
  const trimmed = query.trim();
  const lowerQuery = trimmed.toLowerCase();

  // Run two searches in parallel: full-text and ILIKE title match
  const tsQuery = trimmed.split(/\s+/).join(" & ");

  const [ftsRes, ilikeRes] = await Promise.all([
    supabase
      .from("books")
      .select("*")
      .textSearch("title", tsQuery, { config: "english" })
      .limit(15),
    supabase
      .from("books")
      .select("*")
      .ilike("title", `%${trimmed}%`)
      .limit(15),
  ]);

  // Merge and deduplicate
  const seen = new Set<string>();
  const allBooks: Record<string, unknown>[] = [];
  for (const book of [...(ilikeRes.data ?? []), ...(ftsRes.data ?? [])]) {
    const id = book.id as string;
    if (!seen.has(id)) {
      seen.add(id);
      allBooks.push(book);
    }
  }

  if (allBooks.length === 0) return [];

  // Score by title match quality
  const queryWords = lowerQuery.split(/\s+/);

  function titleRelevanceScore(title: string): number {
    const lowerTitle = title.toLowerCase();
    // Exact match
    if (lowerTitle === lowerQuery) return 100;
    // Title starts with query
    if (lowerTitle.startsWith(lowerQuery)) return 90;
    // Title contains query as substring
    if (lowerTitle.includes(lowerQuery)) return 80;
    // All query words appear in title
    const allWords = queryWords.every((w) => lowerTitle.includes(w));
    if (allWords) return 70;
    // Some query words appear
    const matchCount = queryWords.filter((w) => lowerTitle.includes(w)).length;
    return (matchCount / queryWords.length) * 50;
  }

  // Sort by relevance score descending
  allBooks.sort((a, b) => {
    const scoreA = titleRelevanceScore(a.title as string);
    const scoreB = titleRelevanceScore(b.title as string);
    return scoreB - scoreA;
  });

  const top = allBooks.slice(0, 10);
  const results = await Promise.all(
    top.map((book) => hydrateBookDetail(supabase, book))
  );

  // Filter out books without covers and junk titles
  return results.filter((b) => b.coverUrl && !isJunkTitle(b.title));
}

// ── Write to cache ───────────────────────────────────

/**
 * Save a book from Goodreads data to Supabase.
 * Upserts by goodreads_id (canonical identity).
 */
export async function saveGoodreadsBookToCache(bookData: BookData): Promise<Book | null> {
  if (!bookData.goodreadsId) {
    console.warn("[cache] Cannot save book without goodreads_id:", bookData.title);
    return null;
  }

  const supabase = getAdminClient();
  const slug = generateBookSlug(bookData.title, bookData.goodreadsId);

  const row = {
    title: bookData.title,
    author: bookData.author,
    isbn: bookData.isbn ?? null,
    isbn13: bookData.isbn13 ?? null,
    google_books_id: bookData.googleBooksId ?? null,
    cover_url: cleanCoverUrl(bookData.coverUrl),
    page_count: bookData.pageCount ?? null,
    published_year: bookData.publishedYear ?? null,
    publisher: bookData.publisher ?? null,
    description: bookData.description ?? null,
    goodreads_id: bookData.goodreadsId,
    goodreads_url: bookData.goodreadsUrl ?? null,
    amazon_asin: bookData.amazonAsin ?? null,
    romance_io_slug: bookData.romanceIoSlug ?? null,
    romance_io_heat_label: bookData.romanceIoHeatLabel ?? null,
    genres: bookData.genres ?? [],
    subgenre: bookData.subgenre ?? null,
    metadata_source: "goodreads" as const,
    slug,
    series_name: bookData.seriesName ?? null,
    series_position: bookData.seriesPosition ?? null,
    data_refreshed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("books")
    .upsert(row, { onConflict: "goodreads_id" })
    .select()
    .single();

  if (error || !data) {
    console.warn("[cache] Failed to save book:", error?.message, bookData.title);
    return null;
  }

  return mapDbBook(data);
}

/**
 * Save a book to cache. Requires a valid goodreads_id.
 * Books from Google Books without a Goodreads match are discarded.
 */
export async function saveBookToCache(bookData: BookData): Promise<Book | null> {
  if (!bookData.goodreadsId || bookData.goodreadsId.startsWith("unknown-")) {
    console.warn("[cache] Discarding book without real goodreads_id:", bookData.title);
    return null;
  }
  return saveGoodreadsBookToCache(bookData);
}

export async function saveSynopsis(bookId: string, synopsis: string): Promise<void> {
  const supabase = getAdminClient();
  await supabase
    .from("books")
    .update({ ai_synopsis: synopsis, updated_at: new Date().toISOString() })
    .eq("id", bookId);
}

// ── Helpers ──────────────────────────────────────────

export async function hydrateBookDetail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  dbBook: Record<string, unknown>
): Promise<BookDetail> {
  const book = mapDbBook(dbBook);

  // Fetch ratings, spice, and tropes in parallel
  const [ratingsRes, spiceRes, tropesRes] = await Promise.all([
    supabase.from("book_ratings").select("*").eq("book_id", book.id),
    supabase.from("book_spice").select("*").eq("book_id", book.id),
    supabase
      .from("book_tropes")
      .select("trope_id, tropes(id, slug, name, description)")
      .eq("book_id", book.id),
  ]);

  const ratings: Rating[] = (ratingsRes.data ?? []).map((r: Record<string, unknown>) => ({
    source: r.source as Rating["source"],
    rating: r.rating ? parseFloat(r.rating as string) : null,
    ratingCount: r.rating_count as number | null,
  }));

  const spice: SpiceRating[] = (spiceRes.data ?? []).map((s: Record<string, unknown>) => ({
    source: s.source as SpiceRating["source"],
    spiceLevel: s.spice_level as number,
    ratingCount: s.rating_count as number | null,
    confidence: (s.confidence as SpiceRating["confidence"]) ?? undefined,
  }));

  const tropes: Trope[] = [];
  for (const bt of (tropesRes.data ?? []) as Record<string, unknown>[]) {
    const t = bt.tropes as Record<string, unknown> | null;
    if (!t) continue;
    tropes.push({
      id: t.id as string,
      slug: t.slug as string,
      name: t.name as string,
      description: (t.description as string) ?? null,
    });
  }

  return { ...book, ratings, spice, tropes };
}

export function mapDbBook(row: Record<string, unknown>): Book {
  const goodreadsId = (row.goodreads_id as string) ?? "";
  const title = row.title as string;
  return {
    id: row.id as string,
    isbn: (row.isbn as string) ?? null,
    isbn13: (row.isbn13 as string) ?? null,
    googleBooksId: (row.google_books_id as string) ?? null,
    title,
    author: row.author as string,
    seriesName: (row.series_name as string) ?? null,
    seriesPosition: (row.series_position as number) ?? null,
    coverUrl: (row.cover_url as string) ?? null,
    pageCount: (row.page_count as number) ?? null,
    publishedYear: (row.published_year as number) ?? null,
    publisher: (row.publisher as string) ?? null,
    description: (row.description as string) ?? null,
    aiSynopsis: (row.ai_synopsis as string) ?? null,
    goodreadsId,
    goodreadsUrl: (row.goodreads_url as string) ?? null,
    amazonAsin: (row.amazon_asin as string) ?? null,
    romanceIoSlug: (row.romance_io_slug as string) ?? null,
    romanceIoHeatLabel: (row.romance_io_heat_label as string) ?? null,
    genres: (row.genres as string[]) ?? [],
    subgenre: (row.subgenre as string) ?? null,
    metadataSource: (row.metadata_source as Book["metadataSource"]) ?? "google_books",
    slug: (row.slug as string) ?? generateBookSlug(title, goodreadsId),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    dataRefreshedAt: (row.data_refreshed_at as string) ?? null,
  };
}
