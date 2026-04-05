/**
 * GET /api/reading-dna/suggestions?picked=id1,id2&subgenres=romantasy,historical
 *
 * Smart suggestion grid for the DNA test. Combines three signals:
 * 1. Same series as picked books (highest priority)
 * 2. Other books by same author(s)
 * 3. Books sharing tropes, ranked by overlap + popularity
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

interface SuggestionRow {
  id: string;
  title: string;
  author: string;
  cover_url: string | null;
}

export async function GET(request: NextRequest) {
  const pickedParam = request.nextUrl.searchParams.get("picked")?.trim();
  const subgenreParam = request.nextUrl.searchParams.get("subgenres")?.trim();

  if (!pickedParam) {
    return NextResponse.json({ books: [] });
  }

  const pickedIds = pickedParam.split(",").filter(Boolean);
  if (pickedIds.length === 0) {
    return NextResponse.json({ books: [] });
  }

  const subgenres = subgenreParam
    ? subgenreParam.split(",").filter(Boolean)
    : [];

  const supabase = getAdminClient();
  const pickedSet = new Set(pickedIds);

  // ── 1. Get picked books' metadata (author, series) ──
  const { data: pickedBookRows } = await supabase
    .from("books")
    .select("id, author, series_name")
    .in("id", pickedIds);

  const authors = new Set<string>();
  const seriesNames = new Set<string>();
  for (const b of pickedBookRows ?? []) {
    if (b.author) authors.add(b.author as string);
    if (b.series_name) seriesNames.add(b.series_name as string);
  }

  // ── 2. Fetch same-series and same-author books (parallel) ──
  const seriesPromise = seriesNames.size > 0
    ? supabase
        .from("books")
        .select("id, title, author, cover_url")
        .eq("is_canon", true)
        .not("cover_url", "is", null)
        .in("series_name", Array.from(seriesNames))
        .limit(20)
    : Promise.resolve({ data: [] as SuggestionRow[] });

  const authorPromise = authors.size > 0
    ? supabase
        .from("books")
        .select("id, title, author, cover_url")
        .eq("is_canon", true)
        .not("cover_url", "is", null)
        .in("author", Array.from(authors))
        .limit(30)
    : Promise.resolve({ data: [] as SuggestionRow[] });

  // ── 3. Trope-based suggestions (existing logic) ──
  const { data: pickedTropeRows } = await supabase
    .from("book_tropes")
    .select("trope_id")
    .in("book_id", pickedIds);

  const tropeIds = Array.from(
    new Set((pickedTropeRows ?? []).map((r) => r.trope_id as string))
  );

  let tropeRanked: string[] = [];
  const overlapCounts = new Map<string, number>();

  if (tropeIds.length > 0) {
    const { data: candidateBtRows } = await supabase
      .from("book_tropes")
      .select("book_id, trope_id")
      .in("trope_id", tropeIds);

    for (const bt of candidateBtRows ?? []) {
      const bookId = bt.book_id as string;
      if (pickedSet.has(bookId)) continue;
      overlapCounts.set(bookId, (overlapCounts.get(bookId) ?? 0) + 1);
    }

    tropeRanked = Array.from(overlapCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 80)
      .map(([id]) => id);
  }

  // Wait for series + author queries
  const [seriesResult, authorResult] = await Promise.all([seriesPromise, authorPromise]);

  // ── 4. Build priority buckets ──
  // Priority 1: same series (excluding picked)
  const seriesBooks = (seriesResult.data ?? [])
    .filter((b) => !pickedSet.has(b.id as string))
    .map((b) => b.id as string);

  // Priority 2: same author (excluding picked + series)
  const seriesSet = new Set(seriesBooks);
  const authorBooks = (authorResult.data ?? [])
    .filter((b) => !pickedSet.has(b.id as string) && !seriesSet.has(b.id as string))
    .map((b) => b.id as string);

  // Priority 3: trope overlap (excluding picked + series + author)
  const authorSet = new Set(authorBooks);
  const tropeBooks = tropeRanked.filter(
    (id) => !pickedSet.has(id) && !seriesSet.has(id) && !authorSet.has(id)
  );

  // Merge: series first, then author, then trope-based, cap at 24 IDs
  const mergedIds = [...seriesBooks, ...authorBooks, ...tropeBooks].slice(0, 24);

  if (mergedIds.length === 0) {
    return NextResponse.json({ books: [] });
  }

  // ── 5. Fetch full book details for merged set ──
  let query = supabase
    .from("books")
    .select("id, title, author, cover_url, subgenre")
    .eq("is_canon", true)
    .not("cover_url", "is", null)
    .in("id", mergedIds);

  if (subgenres.length > 0) {
    // Apply subgenre filter only to trope-based books; keep series/author regardless
    // We'll filter after fetching
  }

  const { data: bookRows } = await query;
  if (!bookRows || bookRows.length === 0) {
    return NextResponse.json({ books: [] });
  }

  // Fetch popularity for tiebreaking within trope bucket
  const returnedIds = bookRows.map((b) => b.id as string);
  const { data: ratingRows } = await supabase
    .from("book_ratings")
    .select("book_id, rating_count")
    .eq("source", "goodreads")
    .in("book_id", returnedIds);

  const popularityMap = new Map<string, number>();
  for (const r of ratingRows ?? []) {
    const bookId = r.book_id as string;
    const count = (r.rating_count as number) ?? 0;
    if (count > (popularityMap.get(bookId) ?? 0)) {
      popularityMap.set(bookId, count);
    }
  }

  // Get trope slugs for returned books
  const { data: btRows } = await supabase
    .from("book_tropes")
    .select("book_id, tropes(slug)")
    .in("book_id", returnedIds);

  const bookTropeMap = new Map<string, string[]>();
  for (const bt of (btRows ?? []) as Record<string, unknown>[]) {
    const bookId = bt.book_id as string;
    const tropeData = bt.tropes as { slug: string } | null;
    if (!tropeData) continue;
    const list = bookTropeMap.get(bookId) ?? [];
    list.push(tropeData.slug);
    bookTropeMap.set(bookId, list);
  }

  // ── 6. Sort and filter ──
  // Assign priority scores: series=3, author=2, trope=1
  const priorityMap = new Map<string, number>();
  for (const id of seriesBooks) priorityMap.set(id, 3);
  for (const id of authorBooks) if (!priorityMap.has(id)) priorityMap.set(id, 2);
  for (const id of tropeBooks) if (!priorityMap.has(id)) priorityMap.set(id, 1);

  const subgenreSet = new Set(subgenres);

  const books = bookRows
    .filter((b) => {
      const id = b.id as string;
      const priority = priorityMap.get(id) ?? 0;
      // Always keep series + author books; apply subgenre filter only to trope books
      if (priority >= 2) return true;
      if (subgenreSet.size > 0 && !subgenreSet.has(b.subgenre as string)) return false;
      // Trope books need at least one trope
      const tropes = bookTropeMap.get(id);
      return tropes && tropes.length > 0;
    })
    .sort((a, b) => {
      const prioA = priorityMap.get(a.id as string) ?? 0;
      const prioB = priorityMap.get(b.id as string) ?? 0;
      if (prioB !== prioA) return prioB - prioA;
      // Within same priority, sort by overlap then popularity
      const overlapA = overlapCounts.get(a.id as string) ?? 0;
      const overlapB = overlapCounts.get(b.id as string) ?? 0;
      if (overlapB !== overlapA) return overlapB - overlapA;
      const popA = popularityMap.get(a.id as string) ?? 0;
      const popB = popularityMap.get(b.id as string) ?? 0;
      return popB - popA;
    })
    .slice(0, 12)
    .map((b) => ({
      id: b.id as string,
      title: b.title as string,
      author: b.author as string,
      coverUrl: b.cover_url as string | null,
      tropes: bookTropeMap.get(b.id as string) ?? [],
    }));

  return NextResponse.json({ books });
}
