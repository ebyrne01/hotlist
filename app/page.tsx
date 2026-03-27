export const revalidate = 300; // 5-minute ISR

import { getAdminClient } from "@/lib/supabase/admin";
import HeroSection from "@/components/home/HeroSection";
import PersonalizedShell from "@/components/homepage/PersonalizedShell";
import ValuePropStrip from "@/components/home/ValuePropStrip";
import BookTokBanner from "@/components/home/BookTokBanner";
import TropeGrid from "@/components/home/TropeGrid";
import BookRow from "@/components/books/BookRow";
import { getNYTBestsellerRomance } from "@/lib/books/nyt-lists";
import { getRomanceNewReleases } from "@/lib/books/new-releases";
import { hydrateBookDetailBatch } from "@/lib/books/cache";
import { isJunkTitle } from "@/lib/books/romance-filter";
import { deduplicateBooks, diversifyByAuthor, isCompilationTitle, hasYAGenre } from "@/lib/books/utils";
import { getTopBuzzBooks, getBuzzScoresForBooks } from "@/lib/books/buzz-score";
import { TrendingUp, Sparkles, Swords, Flame } from "lucide-react";
import type { BookDetail } from "@/lib/types";

// Authors who appear on bestseller lists but don't match Hotlist's
// BookTok/romantasy/spice-aware audience. These are women's fiction,
// thriller, inspirational, or legacy mass-market authors whose presence
// in "What's Hot" would signal the wrong brand.
const EXCLUDED_AUTHORS = new Set([
  // Women's fiction / family saga (no HEA, no tropes, no spice)
  "danielle steel",
  "nicholas sparks",
  "jodi picoult",
  "kristin hannah",
  "elin hilderbrand",
  "liane moriarty",
  "barbara taylor bradford",
  "maeve binchy",
  "fern michaels",

  // Thriller/suspense authors with romance subplots
  "j.d. robb",          // Nora Roberts pen name, police procedural
  "james patterson",
  "catherine coulter",
  "iris johansen",
  "janet evanovich",
  "sandra brown",

  // Hallmark/sweet/clean romance (wrong demographic)
  "debbie macomber",
  "robyn carr",
  "raeanne thayne",
  "sherryl woods",
  "susan mallery",

  // Inspirational/Christian romance
  "karen kingsbury",
  "francine rivers",
  "beverly lewis",
  "dee henderson",
  "irene hannon",

  // Legacy/gothic (dated or wrong genre)
  "v.c. andrews",
  "jude deveraux",
]);

/** Confirmed spice sources — not estimated/inferred */
const CONFIRMED_SPICE_SOURCES = new Set(["community", "romance_io"]);
const CONFIRMED_LEGACY_SPICE = new Set(["romance_io", "hotlist_community"]);

/** Check if a book has confirmed (non-estimated) spice data */
function hasConfirmedSpice(book: BookDetail): boolean {
  const hasConfirmedComposite =
    book.compositeSpice && CONFIRMED_SPICE_SOURCES.has(book.compositeSpice.primarySource);
  const hasConfirmedLegacy = book.spice.some((s) => CONFIRMED_LEGACY_SPICE.has(s.source));
  return !!(hasConfirmedComposite || hasConfirmedLegacy);
}

/** Check if a book meets homepage curation quality bar */
function isHomepageQualified(book: BookDetail): boolean {
  if (!book.coverUrl) return false;
  if (isCompilationTitle(book.title)) return false;
  if (EXCLUDED_AUTHORS.has(book.author.toLowerCase())) return false;
  // Must have Goodreads rating
  const grRating = book.ratings.find((r) => r.source === "goodreads");
  if (!grRating || (grRating.ratingCount ?? 0) < 100) return false;
  // Must have confirmed spice (not estimated/inferred)
  if (!hasConfirmedSpice(book)) return false;
  // Must have at least one trope tag — books without tropes look incomplete
  if (book.tropes.length === 0) return false;
  return true;
}

/**
 * What's Hot: NYT bestsellers filtered to romance/romantasy.
 * Supplements with recent nyt_trending history (past 4 weeks) when
 * this week's list has fewer than 10 romance titles.
 * Falls back to top-rated books in our DB if NYT returns nothing.
 */
const MIN_HOT_BOOKS = 6;
const TARGET_HOT_BOOKS = 8;

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
          .eq("is_canon", true)
          .not("cover_url", "is", null);

        if (backfillRows) {
          const filtered = (backfillRows as Record<string, unknown>[]).filter(
            (r) => !isJunkTitle(r.title as string)
          );
          if (filtered.length > 0) {
            const batchMap = await hydrateBookDetailBatch(supabase, filtered);
            for (const row of filtered) {
              const hydrated = batchMap.get(row.id as string);
              if (hydrated) nytBooks.push(hydrated);
            }
          }
        }
      }
    }
  }

  // Apply homepage quality filter (confirmed spice + Goodreads rating)
  const qualified = deduplicateBooks(nytBooks).filter(isHomepageQualified);
  const existingIds = new Set(qualified.map((b) => b.id));

  // Pull in top buzz books as additional candidates
  const buzzResults = await getTopBuzzBooks(30);
  const buzzCandidateIds = buzzResults
    .map((b) => b.bookId)
    .filter((id) => !existingIds.has(id));

  if (buzzCandidateIds.length > 0) {
    const { data: buzzBooks } = await supabase
      .from("books")
      .select("*")
      .in("id", buzzCandidateIds.slice(0, 20))
      .eq("is_canon", true)
      .not("cover_url", "is", null);

    if (buzzBooks) {
      const filtered = (buzzBooks as Record<string, unknown>[]).filter(
        (r) => !isJunkTitle(r.title as string)
      );
      if (filtered.length > 0) {
        const batchMap = await hydrateBookDetailBatch(supabase, filtered);
        for (const row of filtered) {
          const hydrated = batchMap.get(row.id as string);
          if (hydrated && isHomepageQualified(hydrated) && !existingIds.has(hydrated.id)) {
            qualified.push(hydrated);
            existingIds.add(hydrated.id);
          }
        }
      }
    }
  }

  // Backfill with well-enriched books if we still don't have enough
  if (qualified.length < MIN_HOT_BOOKS) {
    // Find books with confirmed spice from romance_io or community
    const { data: spiceRows } = await supabase
      .from("spice_signals")
      .select("book_id")
      .in("source", ["community", "romance_io"])
      .gte("confidence", 0.5)
      .order("updated_at", { ascending: false })
      .limit(40);

    if (spiceRows && spiceRows.length > 0) {
      const candidateIds = spiceRows
        .map((r) => r.book_id as string)
        .filter((id) => !existingIds.has(id));
      const uniqueIds = Array.from(new Set(candidateIds)).slice(0, 20);

      if (uniqueIds.length > 0) {
        const { data: backfillBooks } = await supabase
          .from("books")
          .select("*")
          .in("id", uniqueIds)
          .eq("is_canon", true)
          .not("cover_url", "is", null);

        if (backfillBooks) {
          const filtered = (backfillBooks as Record<string, unknown>[]).filter(
            (r) => !isJunkTitle(r.title as string)
          );
          if (filtered.length > 0) {
            const batchMap = await hydrateBookDetailBatch(supabase, filtered);
            for (const row of filtered) {
              if (qualified.length >= TARGET_HOT_BOOKS) break;
              const hydrated = batchMap.get(row.id as string);
              if (hydrated && isHomepageQualified(hydrated) && !existingIds.has(hydrated.id)) {
                qualified.push(hydrated);
                existingIds.add(hydrated.id);
              }
            }
          }
        }
      }
    }
  }

  if (qualified.length > 0) {
    // Sort by buzz score (primary) + enrichment quality (secondary)
    const buzzScores = await getBuzzScoresForBooks(qualified.map((b) => b.id));
    qualified.sort((a, b) => {
      const aBuzz = buzzScores.get(a.id) ?? 0;
      const bBuzz = buzzScores.get(b.id) ?? 0;
      if (aBuzz !== bBuzz) return bBuzz - aBuzz;
      // Tiebreak: tropes presence + number of rating sources
      const aQuality = (a.tropes.length > 0 ? 10 : 0) + a.ratings.length;
      const bQuality = (b.tropes.length > 0 ? 10 : 0) + b.ratings.length;
      return bQuality - aQuality;
    });
    return diversifyByAuthor(qualified).slice(0, TARGET_HOT_BOOKS);
  }

  // Last-resort fallback: top-rated books regardless of spice
  const { data: topRated } = await supabase
    .from("book_ratings")
    .select("book_id, rating")
    .eq("source", "goodreads")
    .gte("rating", 4.0)
    .not("rating", "is", null)
    .limit(20);

  if (!topRated || topRated.length === 0) return [];

  const fallbackIds = Array.from(new Set(topRated.map((r) => r.book_id)));
  const { data: fallbackBooks } = await supabase
    .from("books")
    .select("*")
    .in("id", fallbackIds)
    .eq("is_canon", true)
    .not("cover_url", "is", null);

  if (!fallbackBooks || fallbackBooks.length === 0) return [];

  const fallbackHydrated: BookDetail[] = [];
  const fallbackFiltered = (fallbackBooks.slice(0, 12) as Record<string, unknown>[]).filter(
    (r) => !isJunkTitle(r.title as string)
  );
  if (fallbackFiltered.length > 0) {
    const batchMap = await hydrateBookDetailBatch(supabase, fallbackFiltered);
    for (const row of fallbackFiltered) {
      const hydrated = batchMap.get(row.id as string);
      if (hydrated) fallbackHydrated.push(hydrated);
    }
  }
  return fallbackHydrated.filter((b) => !!b.coverUrl).slice(0, TARGET_HOT_BOOKS);
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

  // Use spice_signals for confirmed high-spice (>= 4) from trusted sources
  const { data: spiceRows } = await supabase
    .from("spice_signals")
    .select("book_id, spice_value")
    .in("source", ["community", "romance_io"])
    .gte("spice_value", 4)
    .order("spice_value", { ascending: false })
    .limit(30);

  if (!spiceRows || spiceRows.length === 0) return [];

  const bookIds = Array.from(new Set(spiceRows.map((r) => r.book_id as string)));
  const { data: books } = await supabase
    .from("books")
    .select("*")
    .in("id", bookIds)
    .eq("is_canon", true)
    .not("cover_url", "is", null);

  if (!books || books.length === 0) return [];

  const spiceFiltered = (books as Record<string, unknown>[]).filter(
    (r) => !isJunkTitle(r.title as string)
  );
  const hydrated: BookDetail[] = [];
  if (spiceFiltered.length > 0) {
    const batchMap = await hydrateBookDetailBatch(supabase, spiceFiltered);
    for (const row of spiceFiltered) {
      const h = batchMap.get(row.id as string);
      if (h) hydrated.push(h);
    }
  }

  // Spice section filter: confirmed spice >= 4, cover, GR rating, no YA
  // Tropes are nice-to-have but not required — spice is the qualifier here
  const qualified = hydrated.filter((book) => {
    if (!book.coverUrl) return false;
    if (isCompilationTitle(book.title)) return false;
    const grRating = book.ratings.find((r) => r.source === "goodreads");
    if (!grRating || (grRating.ratingCount ?? 0) < 50) return false;
    if (!hasConfirmedSpice(book)) return false;
    if (hasYAGenre(book)) return false;
    const spiceLevel = book.compositeSpice?.score ?? 0;
    return spiceLevel >= 3;
  });

  // Sort: books with tropes first, then by spice level
  qualified.sort((a, b) => {
    const aScore = (a.tropes.length > 0 ? 10 : 0) + (a.compositeSpice?.score ?? 0);
    const bScore = (b.tropes.length > 0 ? 10 : 0) + (b.compositeSpice?.score ?? 0);
    return bScore - aScore;
  });
  return diversifyByAuthor(deduplicateBooks(qualified)).slice(0, 12);
}

/** Romantasy trope slugs — books need at least one to qualify for Romantasy Picks */
const ROMANTASY_TROPE_SLUGS = new Set([
  "fae-faerie", "fated-mates", "dragon-riders", "court-academy",
  "morally-grey", "chosen-one", "found-family", "mortal-immortal",
  "enemies-to-lovers", "forbidden-romance",
  "magic-system", "quest-adventure", "warrior-heroine", "dark-fantasy",
  "prophecy", "royal-court", "soulmates", "slow-burn", "world-building",
  "paranormal", "shapeshifter", "vampire", "witch-wizard", "angels-demons",
]);

function isRomantasyQualified(book: BookDetail): boolean {
  if (!book.coverUrl) return false;
  if (isCompilationTitle(book.title)) return false;
  if (EXCLUDED_AUTHORS.has(book.author.toLowerCase())) return false;
  // Minimum GR 3.9 for "picks" curation (but don't gate on review count —
  // newer romantasy often has low counts and our scraped counts are unreliable)
  const gr = book.ratings.find((r) => r.source === "goodreads");
  if (!gr || gr.rating === null || gr.rating < 3.9) return false;
  // Must have at least one trope
  if (book.tropes.length === 0) return false;
  // Must have at least one romantasy trope
  return book.tropes.some((t) => ROMANTASY_TROPE_SLUGS.has(t.slug));
}

async function getRomantasyPicks(): Promise<BookDetail[]> {
  const supabase = getAdminClient();

  // Find books with romantasy/fantasy-romance genres — query extra for filtering
  const { data: books } = await supabase
    .from("books")
    .select("*")
    .eq("is_canon", true)
    .not("cover_url", "is", null)
    .or(
      "genres.cs.{romantasy},genres.cs.{fantasy romance},genres.cs.{romantic fantasy},genres.cs.{fae},genres.cs.{faerie}"
    )
    .order("updated_at", { ascending: false })
    .limit(40);

  if (!books || books.length === 0) {
    // Fallback: search descriptions for romantasy keywords
    const { data: fallback } = await supabase
      .from("books")
      .select("*")
      .eq("is_canon", true)
      .not("cover_url", "is", null)
      .or("description.ilike.%romantasy%,description.ilike.%fae court%,description.ilike.%fantasy romance%")
      .order("updated_at", { ascending: false })
      .limit(30);

    if (!fallback || fallback.length === 0) return [];

    const fallbackFiltered = (fallback as Record<string, unknown>[]).filter(
      (r) => !isJunkTitle(r.title as string)
    );
    const hydrated: BookDetail[] = [];
    if (fallbackFiltered.length > 0) {
      const batchMap = await hydrateBookDetailBatch(supabase, fallbackFiltered);
      for (const row of fallbackFiltered) {
        const h = batchMap.get(row.id as string);
        if (h) hydrated.push(h);
      }
    }
    return diversifyByAuthor(deduplicateBooks(hydrated.filter(isRomantasyQualified))).slice(0, 8);
  }

  const mainFiltered = (books as Record<string, unknown>[]).filter(
    (r) => !isJunkTitle(r.title as string)
  );
  const hydrated: BookDetail[] = [];
  if (mainFiltered.length > 0) {
    const batchMap = await hydrateBookDetailBatch(supabase, mainFiltered);
    for (const row of mainFiltered) {
      const h = batchMap.get(row.id as string);
      if (h) hydrated.push(h);
    }
  }

  return diversifyByAuthor(deduplicateBooks(hydrated.filter(isRomantasyQualified))).slice(0, 8);
}

async function getTropesWithCounts() {
  const supabase = getAdminClient();

  // Fetch tropes and book counts in parallel
  const [{ data: tropes }, { data: bookTropes }] = await Promise.all([
    supabase
      .from("tropes")
      .select("id, slug, name")
      .order("sort_order", { ascending: true }),
    supabase
      .from("book_tropes")
      .select("trope_id"),
  ]);

  // Count books per trope
  const countMap = new Map<string, number>();
  if (bookTropes) {
    for (const row of bookTropes) {
      const id = row.trope_id as string;
      countMap.set(id, (countMap.get(id) ?? 0) + 1);
    }
  }

  return (tropes ?? []).map((t) => ({
    ...t,
    bookCount: countMap.get(t.id) ?? 0,
  }));
}

async function getHomepageStats() {
  const supabase = getAdminClient();
  const [{ count }, { count: communitySpiceCount }] = await Promise.all([
    supabase.from("books").select("*", { count: "exact", head: true }),
    supabase.from("spice_signals").select("*", { count: "exact", head: true }).eq("source", "community"),
  ]);
  return { bookCount: count ?? 0, communitySpiceCount: communitySpiceCount ?? 0 };
}

async function getBookTokPreviewCovers(): Promise<string[]> {
  const supabase = getAdminClient();

  // Get covers from a recent BookTok grab result
  const { data: recentGrab } = await supabase
    .from("video_grabs")
    .select("result")
    .not("result", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);

  if (!recentGrab) return [];

  for (const grab of recentGrab) {
    const result = grab.result as { books?: { coverUrl?: string }[] } | null;
    if (!result?.books) continue;
    const covers = result.books
      .map((b) => b.coverUrl)
      .filter(Boolean) as string[];
    if (covers.length >= 2) return covers.slice(0, 3);
  }

  return [];
}


export default async function Home() {
  const [hotBooks, newReleases, spicyBooks, romantasyBooks, tropes, stats, previewCovers] = await Promise.all([
    getWhatsHot(),
    getNewReleases(),
    getSpiciest(),
    getRomantasyPicks(),
    getTropesWithCounts(),
    getHomepageStats(),
    getBookTokPreviewCovers(),
  ]);

  // Remove any new releases that already appear in What's Hot
  const hotIds = new Set(hotBooks.map((b) => b.id));
  const filteredReleases = newReleases.filter((b) => !hotIds.has(b.id));

  return (
    <>
      <HeroSection bookCount={stats.bookCount} tropeCount={tropes.length} communitySpiceCount={stats.communitySpiceCount} />

      {/* Personalized content: hotlist bar + ForYou/DNA (client-side, not cached) */}
      <PersonalizedShell />

      <div className="max-w-6xl mx-auto px-4">
        {/* 1. What's Hot — NYT Bestsellers (first book content, immediately after hero) */}
        {hotBooks.length > 0 && (
          <section id="whats-hot" className="py-8">
            <h2 className="heading-section flex items-center gap-2 mb-4">
              <TrendingUp size={20} className="text-fire" aria-hidden="true" />
              What&apos;s Hot
            </h2>
            <BookRow books={hotBooks} />
          </section>
        )}
      </div>

      {/* BookTok CTA — breathing break between book rows */}
      <div className="max-w-6xl mx-auto px-4">
        <BookTokBanner previewCovers={previewCovers} />
      </div>

      <div className="max-w-6xl mx-auto px-4">
        {/* 2. Romantasy Picks */}
        {romantasyBooks.length > 0 && (
          <section className="py-8">
            <h2 className="heading-section flex items-center gap-2 mb-4">
              <Swords size={20} className="text-fire" aria-hidden="true" />
              Romantasy Picks
            </h2>
            <BookRow books={romantasyBooks} />
          </section>
        )}

        {/* 3. New Releases */}
        {filteredReleases.length > 0 && (
          <section className="py-8">
            <h2 className="heading-section flex items-center gap-2 mb-4">
              <Sparkles size={20} className="text-fire" aria-hidden="true" />
              New Releases
            </h2>
            <BookRow books={filteredReleases} />
          </section>
        )}

        {/* 4. Browse by Trope */}
        <section id="tropes" className="py-8 scroll-mt-20">
          <h2 className="heading-section mb-4 text-center">
            Browse by Trope
          </h2>
          <TropeGrid tropes={tropes} />
        </section>

        {/* 5. Turn Up the Heat — only if enough books qualify */}
        {spicyBooks.length >= 5 && (
          <section className="py-8">
            <h2 className="heading-section flex items-center gap-2 mb-4">
              <Flame size={20} className="text-fire" aria-hidden="true" />
              Turn Up the Heat
            </h2>
            <BookRow books={spicyBooks} />
          </section>
        )}

        {/* 6. Value props — relocated to bottom as closer for scrolled-to-end users */}
        <ValuePropStrip />
      </div>
    </>
  );
}
