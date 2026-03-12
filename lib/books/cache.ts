import { getAdminClient } from "@/lib/supabase/admin";
import type { Book, BookData, BookDetail, CompositeSpiceData, Rating, SpiceRating, Trope } from "@/lib/types";
import { getCompositeSpice } from "@/lib/spice/compute-composite";
import { generateBookSlug } from "./goodreads-search";
import { isJunkTitle } from "./romance-filter";
import { deduplicateBooks } from "./utils";

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
  const words = trimmed.split(/\s+/).filter((w) => w.length > 1);

  if (words.length === 0) return [];

  // Build word-based queries: each word must appear in the field
  // This handles "danielle jensen" matching "Danielle L. Jensen"
  // and "bridge kingdom" matching "The Bridge Kingdom"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let titleWordQuery = supabase.from("books").select("*") as any;
  for (const word of words) {
    titleWordQuery = titleWordQuery.ilike("title", `%${word}%`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let authorWordQuery = supabase.from("books").select("*") as any;
  for (const word of words) {
    authorWordQuery = authorWordQuery.ilike("author", `%${word}%`);
  }

  const tsQuery = words.join(" & ");

  const [ftsRes, titleWordRes, authorWordRes] = await Promise.all([
    supabase
      .from("books")
      .select("*")
      .textSearch("title", tsQuery, { config: "english" })
      .limit(15),
    titleWordQuery.limit(15),
    authorWordQuery.limit(20),
  ]);

  // Merge and deduplicate
  const seen = new Set<string>();
  const allBooks: Record<string, unknown>[] = [];
  for (const book of [
    ...(titleWordRes.data ?? []),
    ...(authorWordRes.data ?? []),
    ...(ftsRes.data ?? []),
  ]) {
    const id = book.id as string;
    if (!seen.has(id)) {
      seen.add(id);
      allBooks.push(book);
    }
  }

  if (allBooks.length === 0) return [];

  // Detect if the query looks like an author name (2-3 words, no common title words)
  const TITLE_NOISE = new Set(["the", "of", "and", "a", "an", "in", "to", "for", "is", "on", "at", "by"]);
  const meaningfulWords = words.filter((w) => !TITLE_NOISE.has(w.toLowerCase()));
  const looksLikeAuthor = meaningfulWords.length >= 2 && meaningfulWords.length <= 3;

  // Score by title AND author match quality
  const queryWords = lowerQuery.split(/\s+/);

  function relevanceScore(title: string, author: string): number {
    const lowerTitle = title.toLowerCase();
    const lowerAuthor = author.toLowerCase();

    // Title scoring
    let titleScore = 0;
    if (lowerTitle === lowerQuery) titleScore = 100;
    else if (lowerTitle.startsWith(lowerQuery)) titleScore = 90;
    else if (lowerTitle.includes(lowerQuery)) titleScore = 80;
    else {
      const matchCount = queryWords.filter((w) => lowerTitle.includes(w)).length;
      if (matchCount === queryWords.length) titleScore = 70;
      else titleScore = (matchCount / queryWords.length) * 50;
    }

    // Author scoring — word-by-word so "danielle jensen" matches "Danielle L. Jensen"
    let authorScore = 0;
    const authorMatchCount = queryWords.filter((w) => lowerAuthor.includes(w)).length;
    if (lowerAuthor === lowerQuery) authorScore = 95;
    else if (authorMatchCount === queryWords.length) {
      // All query words found in author — strong match
      // Boost higher if query looks like a person's name
      authorScore = looksLikeAuthor ? 90 : 75;
    } else if (authorMatchCount > 0) {
      authorScore = (authorMatchCount / queryWords.length) * 40;
    }

    return Math.max(titleScore, authorScore);
  }

  // Sort by relevance score descending
  allBooks.sort((a, b) => {
    const scoreA = relevanceScore(a.title as string, a.author as string);
    const scoreB = relevanceScore(b.title as string, b.author as string);
    return scoreB - scoreA;
  });

  const top = allBooks.slice(0, 12);
  const results = await Promise.all(
    top.map((book) => hydrateBookDetail(supabase, book))
  );

  // Filter junk, then deduplicate (keeps edition with most reviews)
  const filtered = results.filter((b) => !isJunkTitle(b.title));
  const deduped = deduplicateBooks(filtered);
  // Sort books without covers to the bottom but still return them
  return deduped.sort((a, b) => {
    if (a.coverUrl && !b.coverUrl) return -1;
    if (!a.coverUrl && b.coverUrl) return 1;
    return 0;
  });
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

  // Check for existing book with same title+author (prevents edition duplicates)
  const normalizedTitle = bookData.title.toLowerCase().replace(/[^\w\s]/g, "").trim();
  const authorLastName = bookData.author.split(" ").pop() ?? bookData.author;
  const { data: existing } = await supabase
    .from("books")
    .select("id, goodreads_id, title, cover_url, ai_synopsis")
    .ilike("title", `%${normalizedTitle}%`)
    .ilike("author", `%${authorLastName}%`)
    .limit(5);

  if (existing && existing.length > 0) {
    for (const row of existing) {
      const rowTitle = ((row.title as string) || "").toLowerCase().replace(/[^\w\s]/g, "").trim();
      if (rowTitle === normalizedTitle && row.goodreads_id !== bookData.goodreadsId) {
        // Same book, different Goodreads ID — don't create a duplicate
        console.log(`[cache] Skipping duplicate: "${bookData.title}" already exists as ${row.goodreads_id}`);
        const { data: fullRow } = await supabase.from("books").select("*").eq("id", row.id).single();
        return fullRow ? mapDbBook(fullRow as Record<string, unknown>) : null;
      }
    }
  }

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

/**
 * Save a book from Google Books as a provisional entry.
 * These books may not have a Goodreads ID yet — they'll get one
 * when the enrichment queue processes their goodreads_detail job.
 */
export async function saveProvisionalBook(bookData: BookData): Promise<Book | null> {
  const supabase = getAdminClient();

  // Check if we already have this book by Google Books ID
  if (bookData.googleBooksId) {
    const { data: existing } = await supabase
      .from("books")
      .select("id")
      .eq("google_books_id", bookData.googleBooksId)
      .single();
    if (existing) return null; // Already have it
  }

  // Check by normalized title + author to avoid duplicates
  const normalizedTitle = bookData.title.toLowerCase().replace(/[^\w\s]/g, "").trim();
  const authorLastName = bookData.author.split(" ").pop()?.toLowerCase() ?? "";
  if (normalizedTitle && authorLastName) {
    const { data: titleMatch } = await supabase
      .from("books")
      .select("id")
      .ilike("title", `%${normalizedTitle}%`)
      .ilike("author", `%${authorLastName}%`)
      .limit(1)
      .single();
    if (titleMatch) return null;
  }

  const slug = `provisional-${bookData.googleBooksId || Date.now()}`;
  const row = {
    title: bookData.title,
    author: bookData.author,
    isbn: bookData.isbn ?? null,
    isbn13: bookData.isbn13 ?? null,
    google_books_id: bookData.googleBooksId ?? null,
    cover_url: bookData.coverUrl ?? null,
    page_count: bookData.pageCount ?? null,
    published_year: bookData.publishedYear ?? null,
    publisher: bookData.publisher ?? null,
    description: bookData.description ?? null,
    goodreads_id: null, // Will be resolved by enrichment queue
    metadata_source: "google_books",
    slug,
    enrichment_status: "pending",
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("books")
    .insert(row)
    .select()
    .single();

  if (error || !data) {
    console.warn("[cache] Failed to save provisional book:", error?.message, bookData.title);
    return null;
  }

  // Queue enrichment jobs for this book
  await queueEnrichmentJobs(data.id as string, bookData.title, bookData.author);

  return mapDbBook(data);
}

// Import from the canonical enrichment queue module and re-export
import { queueEnrichmentJobs } from "@/lib/enrichment/queue";
export { queueEnrichmentJobs };

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

  // Fetch ratings, spice (legacy), composite spice, and tropes in parallel
  const [ratingsRes, spiceRes, compositeSpice, tropesRes] = await Promise.all([
    supabase.from("book_ratings").select("*").eq("book_id", book.id),
    supabase.from("book_spice").select("*").eq("book_id", book.id),
    getCompositeSpice(book.id),
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

  return { ...book, ratings, spice, compositeSpice, tropes };
}

export function mapDbBook(row: Record<string, unknown>): Book {
  const goodreadsId = (row.goodreads_id as string | null) ?? null;
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
    enrichmentStatus: (row.enrichment_status as Book["enrichmentStatus"]) ?? null,
  };
}
