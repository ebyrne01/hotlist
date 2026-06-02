import type { BookDetail } from "@/lib/types";

export const FEATURED_SHELF_LIMIT = 50;
export const FEATURED_SHELF_QUERY_PAGE_SIZE = 1000;
export const FEATURED_SHELF_QUERY_MAX_ROWS = 5000;

const FEATURED_SHELF_BUZZ_BATCH_SIZE = 200;

const HIGH_INTENT_BUZZ_SOURCES = new Set([
  "booktok_grab",
  "amazon_bestseller",
  "nyt_bestseller",
]);

const ROMANTASY_VERIFICATION_GENRES = new Set([
  "romantasy",
  "fantasy romance",
  "romantic fantasy",
  "paranormal romance",
]);

const ROMANTASY_VERIFICATION_TROPES = new Set([
  "fae-faerie",
  "dragon-riders",
  "fated-mates",
  "mortal-immortal",
  "monster-romance",
  "vampire",
  "shifter",
  "court-academy",
  "chosen-one",
]);

export interface ShelfBuzzSignal {
  book_id: string;
  source: string;
  signal_date?: string | null;
}

export async function fetchFeaturedShelfCandidateRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  genreSlug: string
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];

  for (
    let from = 0;
    from < FEATURED_SHELF_QUERY_MAX_ROWS;
    from += FEATURED_SHELF_QUERY_PAGE_SIZE
  ) {
    const to = from + FEATURED_SHELF_QUERY_PAGE_SIZE - 1;
    const { data } = await supabase
      .from("books")
      .select("*")
      .eq("subgenre", genreSlug)
      .eq("is_canon", true)
      .not("cover_url", "is", null)
      .range(from, to);

    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < FEATURED_SHELF_QUERY_PAGE_SIZE) break;
  }

  return rows;
}

export async function fetchShelfBuzzScores(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  bookIds: string[]
) {
  const signals: ShelfBuzzSignal[] = [];

  for (let i = 0; i < bookIds.length; i += FEATURED_SHELF_BUZZ_BATCH_SIZE) {
    const chunk = bookIds.slice(i, i + FEATURED_SHELF_BUZZ_BATCH_SIZE);
    const { data } = await supabase
      .from("book_buzz_signals")
      .select("book_id, source, signal_date")
      .in("book_id", chunk);

    signals.push(...((data ?? []) as ShelfBuzzSignal[]));
  }

  return getHighIntentBuzzScores(signals);
}

export function getHighIntentBuzzScores(signals: ShelfBuzzSignal[] | null | undefined) {
  const scores = new Map<string, number>();

  for (const signal of signals ?? []) {
    if (!HIGH_INTENT_BUZZ_SOURCES.has(signal.source)) continue;
    scores.set(signal.book_id, (scores.get(signal.book_id) ?? 0) + 1);
  }

  return scores;
}

export function isFeaturedGenreBook(
  book: BookDetail,
  genreSlug: string,
  buzzScore = 0,
  now = new Date()
) {
  if (book.subgenre !== genreSlug) return false;

  const verifiedFit =
    genreSlug === "romantasy" ? hasVerifiedRomantasyFit(book) : true;

  if (!verifiedFit) return false;

  return (
    isHotShelfBook(book, buzzScore) ||
    (isNewShelfBook(book, now) && hasVisibleShelfSignal(book))
  );
}

export function rankFeaturedGenreBooks(
  books: BookDetail[],
  genreSlug: string,
  buzzScores: Map<string, number> = new Map(),
  now = new Date()
) {
  return books
    .filter((book) =>
      isFeaturedGenreBook(book, genreSlug, buzzScores.get(book.id) ?? 0, now)
    )
    .sort(
      (a, b) =>
        featuredShelfScore(b, buzzScores.get(b.id) ?? 0, now) -
        featuredShelfScore(a, buzzScores.get(a.id) ?? 0, now)
    );
}

export function featuredShelfScore(
  book: BookDetail,
  buzzScore = 0,
  now = new Date()
) {
  const goodreads = rating(book, "goodreads");
  const amazon = rating(book, "amazon");
  const romanceIo = rating(book, "romance_io");
  const goodreadsCount = goodreads?.ratingCount ?? 0;
  const currentYear = now.getFullYear();
  const age = book.publishedYear ? Math.max(0, currentYear - book.publishedYear) : 8;

  let score = 0;

  if (isNewShelfBook(book, now)) score += 900;
  score += buzzScore * 220;
  score += (romanceIo?.rating ?? 0) * 120;
  score += (amazon?.rating ?? 0) * 90;
  score += (goodreads?.rating ?? 0) * 80;
  score += Math.min(Math.log10(goodreadsCount + 1) * 45, 300);
  score += book.tropes.length * 18;
  if (book.romanceIoSlug) score += 80;
  if (book.compositeSpice?.score) score += 30;
  score -= Math.min(age, 12) * 18;

  return score;
}

function hasVerifiedRomantasyFit(book: BookDetail) {
  const genres = book.genres.map((genre) => genre.toLowerCase());
  const hasGenreSignal = genres.some((genre) =>
    ROMANTASY_VERIFICATION_GENRES.has(genre)
  );
  const hasTropeSignal = book.tropes.some((trope) =>
    ROMANTASY_VERIFICATION_TROPES.has(trope.slug)
  );

  return hasGenreSignal || hasTropeSignal || Boolean(book.romanceIoSlug);
}

function isHotShelfBook(book: BookDetail, buzzScore: number) {
  const goodreads = rating(book, "goodreads");
  const amazon = rating(book, "amazon");
  const romanceIo = rating(book, "romance_io");

  if (!hasVisibleShelfSignal(book)) return false;

  return (
    buzzScore > 0 ||
    (romanceIo?.rating ?? 0) >= 4.0 ||
    (amazon?.rating ?? 0) >= 4.3 ||
    ((goodreads?.rating ?? 0) >= 4.05 &&
      (goodreads?.ratingCount ?? 0) >= 10_000) ||
    ((goodreads?.rating ?? 0) >= 4.2 &&
      (goodreads?.ratingCount ?? 0) >= 1_000)
  );
}

function isNewShelfBook(book: BookDetail, now: Date) {
  if (!book.publishedYear) return false;
  const currentYear = now.getFullYear();
  return book.publishedYear >= currentYear - 1 && book.publishedYear <= currentYear + 1;
}

function hasVisibleShelfSignal(book: BookDetail) {
  return (
    Boolean(book.compositeSpice?.score) ||
    book.tropes.length > 0 ||
    book.ratings.some(
      (bookRating) => bookRating.source === "goodreads" && bookRating.rating !== null
    )
  );
}

function rating(book: BookDetail, source: "goodreads" | "amazon" | "romance_io") {
  return book.ratings.find((bookRating) => bookRating.source === source) ?? null;
}
