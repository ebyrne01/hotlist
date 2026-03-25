/**
 * GET /api/reading-dna/author-books?q=sarah+j+maas
 *
 * Search for books by author name to expand the DNA quiz book pool.
 * Returns lightweight candidate data (id, title, author, coverUrl, tropes).
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ books: [] });
  }

  const supabase = getAdminClient();

  // Search books by author name (case-insensitive)
  const { data: bookRows } = await supabase
    .from("books")
    .select("id, title, author, cover_url")
    .ilike("author", `%${q}%`)
    .not("cover_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(20);

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

  // Only return books that have at least one trope (needed for DNA computation)
  const books = bookRows
    .filter((b) => {
      const tropes = bookTropeMap.get(b.id as string);
      return tropes && tropes.length > 0;
    })
    .map((b) => ({
      id: b.id as string,
      title: b.title as string,
      author: b.author as string,
      coverUrl: b.cover_url as string | null,
      tropes: bookTropeMap.get(b.id as string) ?? [],
    }));

  return NextResponse.json({ books });
}
