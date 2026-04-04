/**
 * GET /api/books/by-tropes?slugs=enemies-to-lovers,forced-proximity
 *
 * Returns books that match the specified tropes (intersection when possible,
 * falls back to any-match if strict intersection yields < 5 results).
 * Used by the multi-select trope filter on /tropes/[slug].
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { getTropeFilterSet } from "@/lib/book-intelligence";
import { hydrateBookDetailBatch } from "@/lib/books/cache";
import { deduplicateBooks, isCompilationTitle } from "@/lib/books/utils";
import { isJunkTitle } from "@/lib/books/romance-filter";
import type { BookDetail } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const slugs = request.nextUrl.searchParams.get("slugs");
  if (!slugs) {
    return NextResponse.json({ error: "slugs parameter required" }, { status: 400 });
  }

  const slugList = slugs.split(",").filter(Boolean);
  if (slugList.length === 0) {
    return NextResponse.json({ books: [] });
  }

  const supabase = getAdminClient();

  // Use shared filter utility — handles ALL-match vs ANY-match fallback
  const tropeSet = await getTropeFilterSet(supabase, slugList);
  if (!tropeSet || tropeSet.ids.size === 0) {
    return NextResponse.json({ books: [] });
  }

  const bookIds = Array.from(tropeSet.ids).slice(0, 50);

  const { data: dbBooks } = await supabase
    .from("books")
    .select("*")
    .in("id", bookIds)
    .eq("is_canon", true)
    .order("updated_at", { ascending: false });

  if (!dbBooks || dbBooks.length === 0) {
    return NextResponse.json({ books: [] });
  }

  // Batch hydrate (replaces per-book hydrateBookDetail calls)
  const hydratedMap = await hydrateBookDetailBatch(
    supabase,
    dbBooks as Record<string, unknown>[]
  );

  const results: BookDetail[] = [];
  for (const book of dbBooks) {
    const hydrated = hydratedMap.get(book.id as string);
    if (hydrated) results.push(hydrated);
  }

  // Sort by trope match count (most matching tropes first), then rating
  if (tropeSet.tropeCounts) {
    const tropeCounts = tropeSet.tropeCounts;
    results.sort((a, b) => {
      const aHits = tropeCounts.get(a.id) ?? 0;
      const bHits = tropeCounts.get(b.id) ?? 0;
      if (bHits !== aHits) return bHits - aHits;
      const aR = a.ratings.find((r) => r.source === "goodreads")?.rating ?? 0;
      const bR = b.ratings.find((r) => r.source === "goodreads")?.rating ?? 0;
      return bR - aR;
    });
  }

  // Deduplicate and filter junk
  const cleanBooks = deduplicateBooks(results).filter((book) => {
    if (isJunkTitle(book.title)) return false;
    if (isCompilationTitle(book.title)) return false;
    if (/\[.*\]/.test(book.title) && book.title.includes("Author:")) return false;
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
      goodreadsRating: b.ratings.find((r) => r.source === "goodreads")?.rating ?? null,
      spiceLevel: b.compositeSpice?.score ? Math.round(b.compositeSpice.score) : null,
      tropes: b.tropes.map((t) => t.name),
    };
  });

  return NextResponse.json({ books: shaped });
}
