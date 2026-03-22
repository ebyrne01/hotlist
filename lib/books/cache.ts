import { getAdminClient } from "@/lib/supabase/admin";
import type { Book, BookData, BookDetail, Rating, SpiceRating, SpotifyPlaylistResult, Trope } from "@/lib/types";
import { getCompositeSpice, getCompositeSpiceBatch } from "@/lib/spice/compute-composite";
import { generateBookSlug } from "./goodreads-search";
import { isJunkTitle } from "./romance-filter";
import { deduplicateBooks, normalizeTitle } from "./utils";

/** Returns null if the URL is a known placeholder image */
function cleanCoverUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.includes("no-cover") || url.includes("nophoto")) return null;
  return url;
}

/** Strip invisible Unicode characters (zero-width spaces, BOM, etc.) from text */
function cleanText(text: string): string {
  return text.replace(/[\u200B\u200C\u200D\u200E\u200F\uFEFF]/g, "").trim();
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
    authorWordQuery.limit(80),
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

  // If exact queries returned nothing, try fuzzy (trigram) search for typo tolerance
  // e.g. "armentraut" → matches "Armentrout" via pg_trgm similarity
  if (allBooks.length === 0) {
    const { data: fuzzyResults } = await supabase.rpc("fuzzy_book_search", {
      search_query: trimmed,
      result_limit: 15,
    });

    if (fuzzyResults && fuzzyResults.length > 0) {
      for (const book of fuzzyResults as Record<string, unknown>[]) {
        const id = book.id as string;
        if (!seen.has(id)) {
          seen.add(id);
          allBooks.push(book);
        }
      }
    }
  }

  if (allBooks.length === 0) return [];


  // Detect if the query looks like an author name (2-3 words, no common title words)
  const TITLE_NOISE = new Set(["the", "of", "and", "a", "an", "in", "to", "for", "is", "on", "at", "by"]);
  const meaningfulWords = words.filter((w) => !TITLE_NOISE.has(w.toLowerCase()));
  const looksLikeAuthor = meaningfulWords.length >= 2 && meaningfulWords.length <= 3;

  // Filter single-letter words (initials like "L", "J") from scoring —
  // they cause false positives when matching against titles
  const queryWords = lowerQuery.split(/\s+/).filter((w) => w.length > 1);

  // Fetch Goodreads rating counts for popularity tiebreaking
  const bookIds = allBooks.map((b) => b.id as string);
  const { data: ratingRows } = await supabase
    .from("book_ratings")
    .select("book_id, rating_count")
    .in("book_id", bookIds)
    .eq("source", "goodreads");
  const popularityMap = new Map<string, number>();
  for (const row of ratingRows ?? []) {
    popularityMap.set(row.book_id as string, (row.rating_count as number) ?? 0);
  }

  function relevanceScore(title: string, author: string): number {
    const lowerTitle = title.toLowerCase();
    const lowerAuthor = author.toLowerCase();

    // Title scoring
    let titleScore = 0;
    if (lowerTitle === lowerQuery) titleScore = 100;
    else if (lowerTitle.startsWith(lowerQuery)) titleScore = 90;
    else if (lowerTitle.includes(lowerQuery)) titleScore = 80;
    else if (queryWords.length > 0) {
      const matchCount = queryWords.filter((w) => lowerTitle.includes(w)).length;
      if (matchCount === queryWords.length) titleScore = 70;
      else titleScore = (matchCount / queryWords.length) * 50;
    }

    // Author scoring — word-by-word so "danielle jensen" matches "Danielle L. Jensen"
    let authorScore = 0;
    if (queryWords.length > 0) {
      const authorMatchCount = queryWords.filter((w) => lowerAuthor.includes(w)).length;
      if (lowerAuthor === lowerQuery) authorScore = 95;
      else if (authorMatchCount === queryWords.length) {
        // All query words found in author — strong match
        // Boost higher if query looks like a person's name
        authorScore = looksLikeAuthor ? 90 : 75;
      } else if (authorMatchCount > 0) {
        authorScore = (authorMatchCount / queryWords.length) * 40;
      }
    }

    return Math.max(titleScore, authorScore);
  }

  // Sort by relevance score descending, then tiebreak
  allBooks.sort((a, b) => {
    const scoreA = relevanceScore(a.title as string, a.author as string);
    const scoreB = relevanceScore(b.title as string, b.author as string);
    if (scoreB !== scoreA) return scoreB - scoreA;
    // For author searches, tiebreak by newest first (readers want latest books)
    // For title searches, tiebreak by popularity (most-reviewed edition first)
    if (looksLikeAuthor) {
      const yearA = (a.published_year as number) ?? 0;
      const yearB = (b.published_year as number) ?? 0;
      if (yearB !== yearA) return yearB - yearA;
    }
    const popA = popularityMap.get(a.id as string) ?? 0;
    const popB = popularityMap.get(b.id as string) ?? 0;
    return popB - popA;
  });

  // For author-like queries, show more results (prolific authors can have 50+ books)
  const displayLimit = looksLikeAuthor ? 48 : 12;
  const top = allBooks.slice(0, displayLimit);
  const results = await Promise.all(
    top.map((book) => hydrateBookDetail(supabase, book))
  );

  // Filter junk, then deduplicate (keeps edition with most reviews)
  const filtered = results.filter((b) => !isJunkTitle(b.title));
  const deduped = deduplicateBooks(filtered);
  // For author searches, sort newest first with coverless books at bottom
  // For other searches, just push coverless books to bottom
  return deduped.sort((a, b) => {
    // Coverless books always sort to the bottom
    if (a.coverUrl && !b.coverUrl) return -1;
    if (!a.coverUrl && b.coverUrl) return 1;
    // Within covered books, sort by year for author searches
    if (looksLikeAuthor) {
      const yearA = a.publishedYear ?? 0;
      const yearB = b.publishedYear ?? 0;
      return yearB - yearA;
    }
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
  const incomingNorm = normalizeTitle(bookData.title);
  const authorLastName = bookData.author.split(" ").pop() ?? bookData.author;
  const { data: existing } = await supabase
    .from("books")
    .select("id, goodreads_id, title, cover_url, ai_synopsis")
    .ilike("author", `%${authorLastName}%`)
    .limit(20);

  if (existing && existing.length > 0) {
    for (const row of existing) {
      const rowNorm = normalizeTitle((row.title as string) || "");
      if (rowNorm === incomingNorm && row.goodreads_id !== bookData.goodreadsId) {
        // Same book, different Goodreads ID — don't create a duplicate.
        // If incoming edition has a cover and existing doesn't, upgrade the existing entry.
        const incomingCover = cleanCoverUrl(bookData.coverUrl);
        if (incomingCover && !row.cover_url) {
          await supabase.from("books").update({ cover_url: incomingCover }).eq("id", row.id);
          console.log(`[cache] Upgraded cover for "${row.title}" from edition ${bookData.goodreadsId}`);
        }
        console.log(`[cache] Skipping duplicate: "${bookData.title}" (${bookData.goodreadsId}) already exists as "${row.title}" (${row.goodreads_id})`);
        const { data: fullRow } = await supabase.from("books").select("*").eq("id", row.id).single();
        return fullRow ? mapDbBook(fullRow as Record<string, unknown>) : null;
      }
    }
  }

  const slug = generateBookSlug(bookData.title, bookData.goodreadsId);

  const row = {
    title: cleanText(bookData.title),
    author: cleanText(bookData.author),
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

  // Queue enrichment jobs only for newly created books (not re-saves of existing ones).
  // On INSERT, created_at is set to now() by the DB default; on UPDATE it stays unchanged.
  const createdAt = new Date(data.created_at as string).getTime();
  const isNewBook = Date.now() - createdAt < 60_000;
  if (isNewBook) {
    await queueEnrichmentJobs(data.id as string, bookData.title, bookData.author);
  }

  return mapDbBook(data);
}

/**
 * Save a book to cache. Routes to the appropriate save function:
 * - Books with a Goodreads ID → full upsert via saveGoodreadsBookToCache
 * - Books without → provisional entry via saveProvisionalBook (enrichment queue resolves later)
 */
export async function saveBookToCache(bookData: BookData): Promise<Book | null> {
  if (!bookData.goodreadsId || bookData.goodreadsId.startsWith("unknown-")) {
    return saveProvisionalBook(bookData);
  }
  return saveGoodreadsBookToCache(bookData);
}

/**
 * Save a book from Google Books as a provisional entry.
 * These books may not have a Goodreads ID yet — they'll get one
 * when the enrichment queue processes their goodreads_detail job.
 */
export async function saveProvisionalBook(bookData: BookData): Promise<Book | null> {
  // Reject junk titles (study guides, workbooks, etc.) from Google Books
  if (isJunkTitle(bookData.title)) return null;

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
  const provNorm = normalizeTitle(bookData.title);
  const authorLastName = bookData.author.split(" ").pop()?.toLowerCase() ?? "";
  if (provNorm && authorLastName) {
    const { data: candidates } = await supabase
      .from("books")
      .select("id, title")
      .ilike("author", `%${authorLastName}%`)
      .limit(20);
    if (candidates?.some((c) => normalizeTitle((c.title as string) || "") === provNorm)) {
      return null;
    }
  }

  const slug = `provisional-${bookData.googleBooksId || Date.now()}`;
  const row = {
    title: cleanText(bookData.title),
    author: cleanText(bookData.author),
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

  // Minimum rating count to display Amazon ratings — low-count ratings from
  // Serper are often wrong-edition matches and misleading (e.g. 5.0 from 6 reviews)
  const MIN_AMAZON_RATING_COUNT = 50;

  const ratings: Rating[] = (ratingsRes.data ?? []).map((r: Record<string, unknown>) => {
    const source = r.source as Rating["source"];
    const rating = r.rating ? parseFloat(r.rating as string) : null;
    const ratingCount = r.rating_count as number | null;

    // Suppress Amazon ratings only when count exists but is suspiciously low
    // (likely a wrong-edition match). Null count = Serper just didn't find it — show the rating.
    if (source === "amazon" && ratingCount != null && ratingCount < MIN_AMAZON_RATING_COUNT) {
      return { source, rating: null, ratingCount };
    }

    return { source, rating, ratingCount };
  });

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

/**
 * Batch-hydrate multiple books in 4 queries total (instead of 4 per book).
 * Returns a Map of bookId → BookDetail.
 */
export async function hydrateBookDetailBatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  dbBooks: Record<string, unknown>[]
): Promise<Map<string, BookDetail>> {
  if (dbBooks.length === 0) return new Map();

  const books = dbBooks.map(mapDbBook);
  const bookIds = books.map((b) => b.id);

  // 4 parallel batch queries instead of 4N sequential queries
  const [ratingsRes, spiceRes, compositeMap, tropesRes] = await Promise.all([
    supabase.from("book_ratings").select("*").in("book_id", bookIds),
    supabase.from("book_spice").select("*").in("book_id", bookIds),
    getCompositeSpiceBatch(bookIds),
    supabase
      .from("book_tropes")
      .select("book_id, trope_id, tropes(id, slug, name, description)")
      .in("book_id", bookIds),
  ]);

  // Index ratings by book_id
  const ratingsMap = new Map<string, Rating[]>();
  for (const r of (ratingsRes.data ?? []) as Record<string, unknown>[]) {
    const bid = r.book_id as string;
    if (!ratingsMap.has(bid)) ratingsMap.set(bid, []);
    ratingsMap.get(bid)!.push({
      source: r.source as Rating["source"],
      rating: r.rating ? parseFloat(r.rating as string) : null,
      ratingCount: r.rating_count as number | null,
    });
  }

  // Index spice by book_id
  const spiceMap = new Map<string, SpiceRating[]>();
  for (const s of (spiceRes.data ?? []) as Record<string, unknown>[]) {
    const bid = s.book_id as string;
    if (!spiceMap.has(bid)) spiceMap.set(bid, []);
    spiceMap.get(bid)!.push({
      source: s.source as SpiceRating["source"],
      spiceLevel: s.spice_level as number,
      ratingCount: (s.rating_count as number) ?? 0,
      confidence: (s.confidence as SpiceRating["confidence"]) ?? undefined,
    });
  }

  // Index tropes by book_id
  const tropesMap = new Map<string, Trope[]>();
  for (const bt of (tropesRes.data ?? []) as Record<string, unknown>[]) {
    const bid = bt.book_id as string;
    const t = bt.tropes as Record<string, unknown> | null;
    if (!t) continue;
    if (!tropesMap.has(bid)) tropesMap.set(bid, []);
    tropesMap.get(bid)!.push({
      id: t.id as string,
      slug: t.slug as string,
      name: t.name as string,
      description: (t.description as string) ?? null,
    });
  }

  const result = new Map<string, BookDetail>();
  for (const book of books) {
    result.set(book.id, {
      ...book,
      ratings: ratingsMap.get(book.id) ?? [],
      spice: spiceMap.get(book.id) ?? [],
      compositeSpice: compositeMap.get(book.id) ?? null,
      tropes: tropesMap.get(book.id) ?? [],
    });
  }

  return result;
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
    booktrackPrompt: (row.booktrack_prompt as string) ?? null,
    booktrackMoods: (row.booktrack_moods as string[]) ?? null,
    spotifyPlaylists: (row.spotify_playlists as SpotifyPlaylistResult[]) ?? null,
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
