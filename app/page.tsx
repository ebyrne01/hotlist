export const dynamic = "force-dynamic";

import { getAdminClient } from "@/lib/supabase/admin";
import HeroSection from "@/components/home/HeroSection";
import BookTokBanner from "@/components/home/BookTokBanner";
import TropeGrid from "@/components/home/TropeGrid";
import BookRow from "@/components/books/BookRow";
import { getNYTBestsellerRomance } from "@/lib/books/nyt-lists";
import { getRomanceNewReleases } from "@/lib/books/new-releases";
import { hydrateBookDetail } from "@/lib/books/cache";
import { isJunkTitle } from "@/lib/books/romance-filter";
import { deduplicateBooks } from "@/lib/books/utils";
import type { BookDetail } from "@/lib/types";

/**
 * What's Hot: NYT bestsellers filtered to romance/romantasy.
 * Supplements with recent nyt_trending history (past 4 weeks) when
 * this week's list has fewer than 10 romance titles.
 * Falls back to top-rated books in our DB if NYT returns nothing.
 */
const MIN_HOT_BOOKS = 10;

async function getWhatsHot(): Promise<BookDetail[]> {
  const supabase = getAdminClient();
  let nytBooks: BookDetail[] = [];

  try {
    nytBooks = await getNYTBestsellerRomance();
  } catch (err) {
    console.warn("[homepage] NYT bestseller fetch failed, falling back:", err);
  }

  // Supplement with recent NYT trending history if we have fewer than 10
  if (nytBooks.length < MIN_HOT_BOOKS) {
    const currentIds = new Set(nytBooks.map((b) => b.id));
    const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();

    const { data: recentTrending } = await supabase
      .from("nyt_trending")
      .select("book_id, weeks_on_list")
      .gte("fetched_at", fourWeeksAgo)
      .order("weeks_on_list", { ascending: false });

    if (recentTrending && recentTrending.length > 0) {
      const seen = new Set<string>();
      const backfillIds: string[] = [];
      for (const row of recentTrending) {
        if (currentIds.has(row.book_id) || seen.has(row.book_id)) continue;
        seen.add(row.book_id);
        backfillIds.push(row.book_id);
        if (nytBooks.length + backfillIds.length >= MIN_HOT_BOOKS) break;
      }

      if (backfillIds.length > 0) {
        const { data: backfillRows } = await supabase
          .from("books")
          .select("*")
          .in("id", backfillIds)
          .not("cover_url", "is", null);

        if (backfillRows) {
          for (const row of backfillRows as Record<string, unknown>[]) {
            if (isJunkTitle(row.title as string)) continue;
            nytBooks.push(await hydrateBookDetail(supabase, row));
          }
        }
      }
    }
  }

  if (nytBooks.length > 0) return deduplicateBooks(nytBooks);

  // Fallback: top-rated books from our database
  const { data: topRated } = await supabase
    .from("book_ratings")
    .select("book_id, rating")
    .not("rating", "is", null);

  if (!topRated || topRated.length === 0) return [];

  const ratingsByBook = new Map<string, number[]>();
  for (const r of topRated) {
    const list = ratingsByBook.get(r.book_id) ?? [];
    list.push(parseFloat(r.rating));
    ratingsByBook.set(r.book_id, list);
  }

  const qualifiedIds: string[] = [];
  const avgMap = new Map<string, number>();
  for (const [bookId, ratings] of Array.from(ratingsByBook)) {
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    if (avg >= 4.0) {
      qualifiedIds.push(bookId);
      avgMap.set(bookId, avg);
    }
  }

  if (qualifiedIds.length === 0) return [];

  const { data: books } = await supabase
    .from("books")
    .select("*")
    .in("id", qualifiedIds)
    .not("cover_url", "is", null);

  if (!books || books.length === 0) return [];

  books.sort((a, b) => (avgMap.get(b.id as string) ?? 0) - (avgMap.get(a.id as string) ?? 0));

  const hydrated: BookDetail[] = [];
  for (const book of books.slice(0, 12) as Record<string, unknown>[]) {
    if (isJunkTitle(book.title as string)) continue;
    hydrated.push(await hydrateBookDetail(supabase, book));
  }

  // Quality threshold: only show books with sufficient Goodreads data + cover
  const qualified = hydrated.filter((book) => {
    if (!book.coverUrl) return false;
    const grRating = book.ratings.find((r) => r.source === "goodreads");
    return grRating && (grRating.ratingCount ?? 0) >= 100;
  });
  return qualified;
}

async function getNewReleases(): Promise<BookDetail[]> {
  try {
    const books = await getRomanceNewReleases();
    return deduplicateBooks(books);
  } catch (err) {
    console.warn("[homepage] New releases fetch failed:", err);
    return [];
  }
}

async function getSpiciest(): Promise<BookDetail[]> {
  const supabase = getAdminClient();

  const { data: spiceRows } = await supabase
    .from("book_spice")
    .select("book_id, spice_level")
    .gte("spice_level", 4)
    .order("spice_level", { ascending: false })
    .limit(12);

  if (!spiceRows || spiceRows.length === 0) return [];

  const bookIds = Array.from(new Set(spiceRows.map((r) => r.book_id)));
  const { data: books } = await supabase
    .from("books")
    .select("*")
    .in("id", bookIds)
    .not("cover_url", "is", null);

  if (!books || books.length === 0) return [];

  const hydrated: BookDetail[] = [];
  for (const book of books as Record<string, unknown>[]) {
    if (isJunkTitle(book.title as string)) continue;
    hydrated.push(await hydrateBookDetail(supabase, book));
  }

  // Quality threshold: only show books with sufficient Goodreads data + cover
  const qualified = hydrated.filter((book) => {
    if (!book.coverUrl) return false;
    const grRating = book.ratings.find((r) => r.source === "goodreads");
    return grRating && (grRating.ratingCount ?? 0) >= 100;
  });
  return deduplicateBooks(qualified);
}

async function getRomantasyPicks(): Promise<BookDetail[]> {
  const supabase = getAdminClient();

  // Find books with romantasy/fantasy-romance genres
  const { data: books } = await supabase
    .from("books")
    .select("*")
    .not("cover_url", "is", null)
    .or(
      "genres.cs.{romantasy},genres.cs.{fantasy romance},genres.cs.{romantic fantasy},genres.cs.{fae},genres.cs.{faerie}"
    )
    .order("updated_at", { ascending: false })
    .limit(30);

  if (!books || books.length === 0) {
    // Fallback: search descriptions for romantasy keywords
    const { data: fallback } = await supabase
      .from("books")
      .select("*")
      .not("cover_url", "is", null)
      .or("description.ilike.%romantasy%,description.ilike.%fae court%,description.ilike.%fantasy romance%")
      .order("updated_at", { ascending: false })
      .limit(20);

    if (!fallback || fallback.length === 0) return [];

    const hydrated: BookDetail[] = [];
    for (const book of fallback as Record<string, unknown>[]) {
      if (isJunkTitle(book.title as string)) continue;
      hydrated.push(await hydrateBookDetail(supabase, book));
    }
    return deduplicateBooks(hydrated.filter((b) => !!b.coverUrl)).slice(0, 12);
  }

  const hydrated: BookDetail[] = [];
  for (const book of books as Record<string, unknown>[]) {
    if (isJunkTitle(book.title as string)) continue;
    hydrated.push(await hydrateBookDetail(supabase, book));
  }

  const qualified = hydrated.filter((b) => {
    if (!b.coverUrl) return false;
    const grRating = b.ratings.find((r) => r.source === "goodreads");
    return grRating && (grRating.ratingCount ?? 0) >= 100;
  });
  return deduplicateBooks(qualified).slice(0, 12);
}

async function getTropes() {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("tropes")
    .select("id, slug, name")
    .order("sort_order", { ascending: true });
  return data ?? [];
}


export default async function Home() {
  const [hotBooks, newReleases, spicyBooks, romantasyBooks, tropes] = await Promise.all([
    getWhatsHot(),
    getNewReleases(),
    getSpiciest(),
    getRomantasyPicks(),
    getTropes(),
  ]);

  // Remove any new releases that already appear in What's Hot
  const hotIds = new Set(hotBooks.map((b) => b.id));
  const filteredReleases = newReleases.filter((b) => !hotIds.has(b.id));

  return (
    <>
      <HeroSection />

      <BookTokBanner />

      <div className="max-w-6xl mx-auto px-4">
        {/* What's Hot — NYT Bestsellers */}
        {hotBooks.length > 0 && (
          <section className="py-8">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-ink mb-4">
              🔥{" "}What&apos;s Hot
            </h2>
            <BookRow books={hotBooks} />
          </section>
        )}

        {/* New Releases */}
        {filteredReleases.length > 0 && (
          <section className="py-8">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-ink mb-4">
              ✨ New Releases
            </h2>
            <BookRow books={filteredReleases} />
          </section>
        )}

        {/* Romantasy Picks */}
        {romantasyBooks.length > 0 && (
          <section className="py-8">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-ink mb-4">
              🗡️ Romantasy Picks
            </h2>
            <BookRow books={romantasyBooks} />
          </section>
        )}

        {/* Browse by Trope */}
        <section id="tropes" className="py-8 scroll-mt-20">
          <h2 className="font-display text-xl sm:text-2xl font-bold text-ink mb-4 text-center">
            Browse by Trope
          </h2>
          <TropeGrid tropes={tropes} />
        </section>

        {/* Spiciest Right Now */}
        {spicyBooks.length > 0 && (
          <section className="py-8">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-ink mb-4">
              🌶️{" "}Turn Up the Heat
            </h2>
            <BookRow books={spicyBooks} />
          </section>
        )}

        {/* What is Hotlist explainer */}
        <section className="py-12 border-t border-border">
          <div className="max-w-lg mx-auto text-center">
            <h2 className="font-display text-2xl font-bold text-ink italic">
              What is Hotlist?
            </h2>
            <div className="mt-6 space-y-4 text-left">
              <div className="flex gap-3">
                <span className="text-xl shrink-0">📊</span>
                <p className="text-sm font-body text-muted">
                  <strong className="text-ink">Every rating in one place.</strong> Goodreads, Amazon, and community ratings side by side so you can compare.
                </p>
              </div>
              <div className="flex gap-3">
                <span className="text-xl shrink-0">🌶️</span>
                <p className="text-sm font-body text-muted">
                  <strong className="text-ink">Know the spice before you start.</strong> Spice levels and trope tags so you always know what you&apos;re getting into.
                </p>
              </div>
              <div className="flex gap-3">
                <span className="text-xl shrink-0">🔥</span>
                <p className="text-sm font-body text-muted">
                  <strong className="text-ink">Build your Hotlist.</strong> Save books to a comparison table and decide what to read next.
                </p>
              </div>
              <div className="flex gap-3">
                <span className="text-xl shrink-0">📹</span>
                <p className="text-sm font-body text-muted">
                  <strong className="text-ink">BookTok {"\u2192"} Hotlist.</strong> Paste a TikTok, Reels, or YouTube link and we&apos;ll pull every book rec automatically.{" "}
                  <a href="/booktok" className="text-fire hover:text-fire/80 font-mono text-xs transition-colors">
                    Try it &rarr;
                  </a>
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
