/**
 * GET /api/reading-dna/search?q=fourth+wing
 *
 * Lightweight book search for the DNA test flow.
 * Searches title and author via ilike. Returns lightweight candidate data.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ books: [] });
  }

  const supabase = getAdminClient();

  // Search by title, author, or series name (case-insensitive)
  const { data: bookRows } = await supabase
    .from("books")
    .select("id, title, author, cover_url")
    .eq("is_canon", true)
    .not("cover_url", "is", null)
    .or(`title.ilike.%${q}%,author.ilike.%${q}%,series_name.ilike.%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(15);

  if (!bookRows || bookRows.length === 0) {
    return NextResponse.json({ books: [] });
  }

  // Get tropes for these books
  const bookIds = bookRows.map((b) => b.id as string);
  const { data: btRows } = await supabase
    .from("book_tropes")
    .select("book_id, tropes(slug)")
    .in("book_id", bookIds);

  const bookTropeMap = new Map<string, string[]>();
  for (const bt of (btRows ?? []) as Record<string, unknown>[]) {
    const bookId = bt.book_id as string;
    const tropeData = bt.tropes as { slug: string } | null;
    if (!tropeData) continue;
    const list = bookTropeMap.get(bookId) ?? [];
    list.push(tropeData.slug);
    bookTropeMap.set(bookId, list);
  }

  // Return all matching books — tropes are optional (books without tropes
  // still contribute author/series signal to suggestions)
  const books = bookRows
    .map((b) => ({
      id: b.id as string,
      title: b.title as string,
      author: b.author as string,
      coverUrl: b.cover_url as string | null,
      tropes: bookTropeMap.get(b.id as string) ?? [],
    }));

  return NextResponse.json({ books });
}
