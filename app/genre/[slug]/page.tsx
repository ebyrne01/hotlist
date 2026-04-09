import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAdminClient } from "@/lib/supabase/admin";
import { hydrateBookDetailBatch } from "@/lib/books/cache";
import { deduplicateBooks, isCompilationTitle } from "@/lib/books/utils";
import { isJunkTitle } from "@/lib/books/romance-filter";
import { CANONICAL_SUBGENRES } from "@/lib/books/subgenre-classifier";
import type { BookDetail } from "@/lib/types";
import GenreFilterClient from "./GenreFilterClient";

interface GenrePageProps {
  params: { slug: string };
}

function findSubgenre(slug: string) {
  return CANONICAL_SUBGENRES.find((s) => s.slug === slug);
}

export async function generateStaticParams() {
  return CANONICAL_SUBGENRES.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({
  params,
}: GenrePageProps): Promise<Metadata> {
  const subgenre = findSubgenre(params.slug);
  if (!subgenre) return { title: "Genre Not Found — Hotlist" };

  const title = `${subgenre.label} Books — Hotlist`;
  const description = `Browse ${subgenre.label.toLowerCase()} books. ${subgenre.description}. Compare spice levels, ratings, and tropes on Hotlist.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}

export default async function GenrePage({ params }: GenrePageProps) {
  const subgenre = findSubgenre(params.slug);
  if (!subgenre) notFound();

  const supabase = getAdminClient();

  // Count total books in this genre
  const { count: totalBookCount } = await supabase
    .from("books")
    .select("id", { count: "exact", head: true })
    .eq("subgenre", params.slug)
    .eq("is_canon", true);

  // Fetch top books by popularity (GR rating count) — ensures blockbusters appear first
  const PAGE_SIZE = 50;

  // Step 1: get the most popular book IDs in this genre via book_ratings join
  const { data: topRated } = await supabase
    .from("book_ratings")
    .select("book_id, rating_count")
    .eq("source", "goodreads")
    .not("rating_count", "is", null)
    .order("rating_count", { ascending: false })
    .limit(5000);

  // Step 2: get all canon book IDs in this genre
  const { data: genreBookRows } = await supabase
    .from("books")
    .select("id")
    .eq("subgenre", params.slug)
    .eq("is_canon", true)
    .not("cover_url", "is", null);

  const genreBookIds = new Set(
    (genreBookRows ?? []).map((r: { id: string }) => r.id)
  );

  // Step 3: intersect and take top PAGE_SIZE
  const topBookIds = (topRated ?? [])
    .filter((r: { book_id: string }) => genreBookIds.has(r.book_id))
    .slice(0, PAGE_SIZE)
    .map((r: { book_id: string }) => r.book_id);

  // Step 4: fetch full book rows
  const { data: dbBooks } = topBookIds.length > 0
    ? await supabase
        .from("books")
        .select("*")
        .in("id", topBookIds)
        .eq("is_canon", true)
    : { data: null };

  const books: BookDetail[] = [];
  const relatedTropeMap = new Map<
    string,
    { slug: string; name: string; count: number }
  >();

  if (dbBooks && dbBooks.length > 0) {
    const hydratedMap = await hydrateBookDetailBatch(
      supabase,
      dbBooks as Record<string, unknown>[]
    );

    // Preserve popularity order from topBookIds
    const idOrder = new Map(topBookIds.map((id: string, i: number) => [id, i]));
    for (const row of dbBooks) {
      const hydrated = hydratedMap.get(row.id as string);
      if (hydrated) books.push(hydrated);
    }
    books.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));

    // Find top tropes across books in this genre (for filter refinement)
    const bookIds = dbBooks.map((b) => b.id as string);
    const { data: bookTropes } = await supabase
      .from("book_tropes")
      .select("book_id, trope_id, tropes(id, slug, name)")
      .in("book_id", bookIds);

    if (bookTropes) {
      for (const bt of bookTropes as Record<string, unknown>[]) {
        const t = bt.tropes as Record<string, unknown> | null;
        if (!t) continue;
        const slug = t.slug as string;
        if (!relatedTropeMap.has(slug)) {
          relatedTropeMap.set(slug, {
            slug,
            name: t.name as string,
            count: 0,
          });
        }
        relatedTropeMap.get(slug)!.count++;
      }
    }
  }

  // Sort tropes by frequency, take top 15
  const topTropes = Array.from(relatedTropeMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // Deduplicate and filter junk
  const cleanBooks = deduplicateBooks(books).filter((book) => {
    if (isJunkTitle(book.title)) return false;
    if (isCompilationTitle(book.title)) return false;
    if (/\[.*\]/.test(book.title) && book.title.includes("Author:"))
      return false;
    if (book.title.length > 100) return false;
    return true;
  });

  // Shape for client
  const initialBooks = cleanBooks.map((b) => {
    let coverUrl = b.coverUrl;
    if (
      coverUrl &&
      (coverUrl.includes("nophoto") ||
        coverUrl.includes("no-cover") ||
        coverUrl.includes("placeholder"))
    ) {
      coverUrl = null;
    }

    return {
      id: b.id,
      title: b.title,
      author: b.author,
      slug: b.slug,
      coverUrl,
      goodreadsRating:
        b.ratings.find((r) => r.source === "goodreads")?.rating ?? null,
      spiceLevel: b.compositeSpice?.score
        ? Math.round(b.compositeSpice.score)
        : null,
      tropes: b.tropes.map((t) => t.name),
    };
  });

  return (
    <GenreFilterClient
      genre={{
        slug: subgenre.slug,
        label: subgenre.label,
        description: subgenre.description,
      }}
      topTropes={topTropes}
      initialBooks={initialBooks}
      initialBookCount={totalBookCount ?? cleanBooks.length}
    />
  );
}
