export const revalidate = 3600;

import { getAdminClient } from "@/lib/supabase/admin";
import { hydrateBookDetailBatch } from "@/lib/books/cache";
import { CANONICAL_SUBGENRES } from "@/lib/books/subgenre-classifier";
import HeroSection from "@/components/home/HeroSection";
import BookTokGrabCta from "@/components/home/BookTokGrabCta";
import ShowcaseGrid, { type ShowcaseBook } from "@/components/home/ShowcaseGrid";
import ValuePropCards from "@/components/home/ValuePropCards";
import CreatorSpotlight, { type SpotlightCreator } from "@/components/home/CreatorSpotlight";
import GenrePills from "@/components/home/GenrePills";
import type { BookDetail } from "@/lib/types";

const SHOWCASE_SLUGS = [
  "a-court-of-thorns-and-roses-50659467",
  "fourth-wing-61431922",
  "haunting-adeline-211158100",
  "icebreaker-61767292",
  "quicksilver-217536270",
  "the-serpent-and-the-wings-of-night-60714999",
];

function shapeShowcaseBook(book: BookDetail): ShowcaseBook {
  return {
    id: book.id,
    slug: book.slug,
    title: book.title,
    author: book.author,
    coverUrl: book.coverUrl,
    goodreadsRating:
      book.ratings.find((r) => r.source === "goodreads")?.rating ?? null,
    amazonRating:
      book.ratings.find((r) => r.source === "amazon")?.rating ?? null,
    romanceIoRating:
      book.ratings.find((r) => r.source === "romance_io")?.rating ?? null,
    spiceLevel: book.compositeSpice?.score
      ? Math.round(book.compositeSpice.score)
      : null,
    tropes: book.tropes.map((t) => t.name),
  };
}

async function getShowcaseBooks(): Promise<ShowcaseBook[]> {
  const supabase = getAdminClient();

  const { data: dbBooks } = await supabase
    .from("books")
    .select("*")
    .in("slug", SHOWCASE_SLUGS)
    .eq("is_canon", true);

  if (!dbBooks || dbBooks.length === 0) return [];

  const hydratedMap = await hydrateBookDetailBatch(
    supabase,
    dbBooks as Record<string, unknown>[]
  );

  // Preserve the order of SHOWCASE_SLUGS
  const slugToBook = new Map<string, BookDetail>();
  for (const row of dbBooks) {
    const hydrated = hydratedMap.get(row.id as string);
    if (hydrated) slugToBook.set(row.slug as string, hydrated);
  }

  return SHOWCASE_SLUGS.map((slug) => slugToBook.get(slug))
    .filter((b): b is BookDetail => !!b)
    .map(shapeShowcaseBook);
}

async function getTrendingCreators(): Promise<SpotlightCreator[]> {
  const supabase = getAdminClient();

  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: creators } = await supabase
    .from("creator_handles")
    .select("id, handle, platform, book_count")
    .gte("last_grabbed_at", thirtyDaysAgo)
    .gt("book_count", 0)
    .order("grab_count", { ascending: false })
    .limit(8);

  if (!creators) return [];

  return creators.map((c: Record<string, unknown>) => ({
    id: c.id as string,
    handle: c.handle as string,
    platform: (c.platform as string) ?? "tiktok",
    bookCount: (c.book_count as number) ?? 0,
  }));
}

export default async function Home() {
  const [showcaseBooks, trendingCreators] = await Promise.all([
    getShowcaseBooks(),
    getTrendingCreators(),
  ]);

  return (
    <>
      <HeroSection />

      <div className="max-w-6xl mx-auto px-4 space-y-2">
        <BookTokGrabCta />
        <ShowcaseGrid books={showcaseBooks} />
        <ValuePropCards />
        <CreatorSpotlight creators={trendingCreators} />
        <GenrePills genres={CANONICAL_SUBGENRES} />
      </div>
    </>
  );
}
