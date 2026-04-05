/**
 * GET /api/reading-dna/suggestions?picked=id1,id2&subgenres=romantasy,historical
 *
 * Smart suggestion grid for the DNA test. Finds books sharing tropes with
 * the user's picked books, optionally filtered by subgenre.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

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

  // Get tropes for picked books
  const { data: pickedTropeRows } = await supabase
    .from("book_tropes")
    .select("trope_id")
    .in("book_id", pickedIds);

  if (!pickedTropeRows || pickedTropeRows.length === 0) {
    return NextResponse.json({ books: [] });
  }

  const tropeIds = Array.from(
    new Set(pickedTropeRows.map((r) => r.trope_id as string))
  );

  // Find other books sharing those tropes
  const { data: candidateBtRows } = await supabase
    .from("book_tropes")
    .select("book_id, trope_id")
    .in("trope_id", tropeIds);

  if (!candidateBtRows || candidateBtRows.length === 0) {
    return NextResponse.json({ books: [] });
  }

  // Count trope overlap per book, excluding already-picked
  const pickedSet = new Set(pickedIds);
  const overlapCounts = new Map<string, number>();
  for (const bt of candidateBtRows) {
    const bookId = bt.book_id as string;
    if (pickedSet.has(bookId)) continue;
    overlapCounts.set(bookId, (overlapCounts.get(bookId) ?? 0) + 1);
  }

  // Sort by overlap count, take top candidates
  const ranked = Array.from(overlapCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([id]) => id);

  if (ranked.length === 0) {
    return NextResponse.json({ books: [] });
  }

  // Fetch book details, with optional subgenre filter
  let query = supabase
    .from("books")
    .select("id, title, author, cover_url, subgenre")
    .eq("is_canon", true)
    .not("cover_url", "is", null)
    .in("id", ranked);

  if (subgenres.length > 0) {
    query = query.in("subgenre", subgenres);
  }

  const { data: bookRows } = await query;
  if (!bookRows || bookRows.length === 0) {
    return NextResponse.json({ books: [] });
  }

  // Get trope slugs for returned books
  const returnedIds = bookRows.map((b) => b.id as string);
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

  // Only include books with tropes, sort by overlap
  const overlapOrder = new Map(ranked.map((id, i) => [id, i]));
  const books = bookRows
    .filter((b) => {
      const tropes = bookTropeMap.get(b.id as string);
      return tropes && tropes.length > 0;
    })
    .sort(
      (a, b) =>
        (overlapOrder.get(a.id as string) ?? 999) -
        (overlapOrder.get(b.id as string) ?? 999)
    )
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
