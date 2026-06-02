/**
 * GET /api/books/by-genre?slug=romantasy&tropes=enemies-to-lovers,fated-mates
 *
 * Returns books matching a subgenre, optionally filtered by tropes (AND logic).
 * Used by the genre browse pages at /genre/[slug].
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { getTropeFilterSet } from "@/lib/book-intelligence";
import { hydrateBookDetailBatch } from "@/lib/books/cache";
import { deduplicateBooks, isPublicSearchSuppressedTitle } from "@/lib/books/utils";
import { isJunkTitle } from "@/lib/books/romance-filter";
import {
  FEATURED_SHELF_LIMIT,
  fetchFeaturedShelfCandidateRows,
  fetchShelfBuzzScores,
  rankFeaturedGenreBooks,
} from "@/lib/books/featured-shelf";
import type { BookDetail } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json(
      { error: "slug parameter required" },
      { status: 400 }
    );
  }

  const supabase = getAdminClient();

  const genreBookRows = await fetchFeaturedShelfCandidateRows(supabase, slug);

  if (genreBookRows.length === 0) {
    return NextResponse.json({ books: [] });
  }

  // If tropes specified, narrow to trope-matching books within this genre
  const tropeSlugs = request.nextUrl.searchParams
    .get("tropes")
    ?.split(",")
    .filter(Boolean);

  let candidateRows = genreBookRows;

  if (tropeSlugs && tropeSlugs.length > 0) {
    const tropeSet = await getTropeFilterSet(supabase, tropeSlugs);
    if (!tropeSet || tropeSet.ids.size === 0) {
      return NextResponse.json({ books: [] });
    }
    candidateRows = candidateRows.filter((row) =>
      tropeSet.ids.has(row.id as string)
    );
  }

  if (candidateRows.length === 0) {
    return NextResponse.json({ books: [] });
  }

  const hydratedMap = await hydrateBookDetailBatch(
    supabase,
    candidateRows as Record<string, unknown>[]
  );

  const results: BookDetail[] = [];
  for (const book of candidateRows) {
    const hydrated = hydratedMap.get(book.id as string);
    if (hydrated) results.push(hydrated);
  }

  const buzzScores = await fetchShelfBuzzScores(
    supabase,
    results.map((book) => book.id)
  );

  // Deduplicate, filter junk, then rank by verified hot/new shelf quality.
  const cleanBooks = deduplicateBooks(results).filter((book) => {
    if (isJunkTitle(book.title)) return false;
    if (isPublicSearchSuppressedTitle(book.title)) return false;
    if (/\[.*\]/.test(book.title) && book.title.includes("Author:"))
      return false;
    if (book.title.length > 100) return false;
    return true;
  });

  const featuredBooks = rankFeaturedGenreBooks(cleanBooks, slug, buzzScores).slice(
    0,
    FEATURED_SHELF_LIMIT
  );

  // Shape for client
  const shaped = featuredBooks.map((b) => {
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

  return NextResponse.json({ books: shaped });
}
