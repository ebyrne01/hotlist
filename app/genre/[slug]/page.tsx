import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAdminClient } from "@/lib/supabase/admin";
import { hydrateBookDetailBatch } from "@/lib/books/cache";
import { deduplicateBooks, isPublicSearchSuppressedTitle } from "@/lib/books/utils";
import { isJunkTitle } from "@/lib/books/romance-filter";
import { CANONICAL_SUBGENRES } from "@/lib/books/subgenre-classifier";
import {
  FEATURED_SHELF_LIMIT,
  fetchFeaturedShelfCandidateRows,
  fetchShelfBuzzScores,
  rankFeaturedGenreBooks,
} from "@/lib/books/featured-shelf";
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

  // Featured shelves should lead with verified hot/new titles, not just the
  // biggest legacy Goodreads count.
  const genreBookRows = await fetchFeaturedShelfCandidateRows(
    supabase,
    params.slug
  );

  const books: BookDetail[] = [];
  const relatedTropeMap = new Map<
    string,
    { slug: string; name: string; count: number }
  >();

  if (genreBookRows.length > 0) {
    const hydratedMap = await hydrateBookDetailBatch(
      supabase,
      genreBookRows as Record<string, unknown>[]
    );

    for (const row of genreBookRows) {
      const hydrated = hydratedMap.get(row.id as string);
      if (hydrated) books.push(hydrated);
    }

    // Find top tropes across books in this genre (for filter refinement)
    const bookIds = genreBookRows.map((b) => b.id as string);
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

  const buzzScores =
    books.length > 0
      ? await fetchShelfBuzzScores(
          supabase,
          books.map((book) => book.id)
        )
      : new Map<string, number>();

  // Deduplicate, filter junk, then rank by verified hot/new shelf quality.
  const cleanBooks = deduplicateBooks(books).filter((book) => {
    if (isJunkTitle(book.title)) return false;
    if (isPublicSearchSuppressedTitle(book.title)) return false;
    if (/\[.*\]/.test(book.title) && book.title.includes("Author:"))
      return false;
    if (book.title.length > 100) return false;
    return true;
  });

  const featuredBooks = rankFeaturedGenreBooks(
    cleanBooks,
    params.slug,
    buzzScores
  ).slice(0, FEATURED_SHELF_LIMIT);

  // Shape for client
  const initialBooks = featuredBooks.map((b) => {
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
