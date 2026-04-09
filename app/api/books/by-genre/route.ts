/**
 * GET /api/books/by-genre?slug=romantasy&tropes=enemies-to-lovers,fated-mates
 *
 * Returns books matching a subgenre, optionally filtered by tropes (AND logic).
 * Used by the genre browse pages at /genre/[slug].
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { getTropeFilterSet } from "@/lib/book-intelligence";
import { hydrateBookDetailBatch } from "@/lib/books/cache";
import { deduplicateBooks, isCompilationTitle } from "@/lib/books/utils";
import { isJunkTitle } from "@/lib/books/romance-filter";
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

  // Get all canon book IDs in this genre
  const { data: genreBookRows } = await supabase
    .from("books")
    .select("id")
    .eq("subgenre", slug)
    .eq("is_canon", true)
    .not("cover_url", "is", null);

  const genreBookIds = new Set(
    (genreBookRows ?? []).map((r: { id: string }) => r.id)
  );

  if (genreBookIds.size === 0) {
    return NextResponse.json({ books: [] });
  }

  // If tropes specified, narrow to trope-matching books within this genre
  const tropeSlugs = request.nextUrl.searchParams
    .get("tropes")
    ?.split(",")
    .filter(Boolean);

  let candidateIds: string[];

  if (tropeSlugs && tropeSlugs.length > 0) {
    const tropeSet = await getTropeFilterSet(supabase, tropeSlugs);
    if (!tropeSet || tropeSet.ids.size === 0) {
      return NextResponse.json({ books: [] });
    }
    // Intersect trope matches with genre
    candidateIds = Array.from(tropeSet.ids).filter((id) =>
      genreBookIds.has(id)
    );
  } else {
    candidateIds = Array.from(genreBookIds);
  }

  if (candidateIds.length === 0) {
    return NextResponse.json({ books: [] });
  }

  // Rank by GR rating count (popularity) and take top 100
  const { data: topRated } = await supabase
    .from("book_ratings")
    .select("book_id, rating_count")
    .eq("source", "goodreads")
    .in("book_id", candidateIds.slice(0, 500))
    .not("rating_count", "is", null)
    .order("rating_count", { ascending: false })
    .limit(100);

  const rankedIds = (topRated ?? []).map(
    (r: { book_id: string }) => r.book_id
  );

  // Add any candidates without GR ratings at the end
  const rankedSet = new Set(rankedIds);
  for (const id of candidateIds) {
    if (!rankedSet.has(id) && rankedIds.length < 100) {
      rankedIds.push(id);
    }
  }

  const { data: dbBooks } = await supabase
    .from("books")
    .select("*")
    .in("id", rankedIds.slice(0, 100))
    .eq("is_canon", true);

  if (!dbBooks || dbBooks.length === 0) {
    return NextResponse.json({ books: [] });
  }

  const hydratedMap = await hydrateBookDetailBatch(
    supabase,
    dbBooks as Record<string, unknown>[]
  );

  // Preserve popularity order from rankedIds
  const idOrder = new Map(rankedIds.map((id: string, i: number) => [id, i]));
  const results: BookDetail[] = [];
  for (const book of dbBooks) {
    const hydrated = hydratedMap.get(book.id as string);
    if (hydrated) results.push(hydrated);
  }
  results.sort(
    (a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999)
  );

  // Deduplicate and filter junk
  const cleanBooks = deduplicateBooks(results).filter((book) => {
    if (isJunkTitle(book.title)) return false;
    if (isCompilationTitle(book.title)) return false;
    if (/\[.*\]/.test(book.title) && book.title.includes("Author:"))
      return false;
    if (book.title.length > 100) return false;
    return true;
  });

  // Shape for client
  const shaped = cleanBooks.map((b) => {
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
