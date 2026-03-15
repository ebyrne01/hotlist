/**
 * GET /api/books/by-tropes?slugs=enemies-to-lovers,forced-proximity
 *
 * Returns books that match ALL of the specified tropes (intersection).
 * Used by the multi-select trope filter on /tropes/[slug].
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { hydrateBookDetail } from "@/lib/books/cache";
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

  // Look up trope IDs from slugs
  const { data: tropes } = await supabase
    .from("tropes")
    .select("id, slug")
    .in("slug", slugList);

  if (!tropes || tropes.length === 0) {
    return NextResponse.json({ books: [] });
  }

  const tropeIds = tropes.map((t) => t.id as string);

  // Find books that have ALL selected tropes (intersection)
  // Query book_tropes for all selected trope IDs, group by book_id,
  // and keep only books that appear tropeIds.length times
  const { data: bookTropes } = await supabase
    .from("book_tropes")
    .select("book_id")
    .in("trope_id", tropeIds);

  if (!bookTropes || bookTropes.length === 0) {
    return NextResponse.json({ books: [] });
  }

  // Count how many of the selected tropes each book has
  const tropeCountByBook = new Map<string, number>();
  for (const bt of bookTropes) {
    const id = bt.book_id as string;
    tropeCountByBook.set(id, (tropeCountByBook.get(id) ?? 0) + 1);
  }

  // Keep only books that match ALL selected tropes
  const matchingBookIds = Array.from(tropeCountByBook.entries())
    .filter(([, count]) => count >= tropeIds.length)
    .map(([id]) => id);

  if (matchingBookIds.length === 0) {
    return NextResponse.json({ books: [] });
  }

  // Fetch and hydrate matching books
  const { data: dbBooks } = await supabase
    .from("books")
    .select("*")
    .in("id", matchingBookIds.slice(0, 30))
    .order("updated_at", { ascending: false });

  if (!dbBooks || dbBooks.length === 0) {
    return NextResponse.json({ books: [] });
  }

  const books = await Promise.all(
    (dbBooks as Record<string, unknown>[]).map((b) => hydrateBookDetail(supabase, b))
  );

  // Shape for client
  const shaped = books.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    slug: b.slug,
    coverUrl: b.coverUrl,
    goodreadsRating: b.ratings.find((r) => r.source === "goodreads")?.rating ?? null,
    spiceLevel: b.compositeSpice?.score ? Math.round(b.compositeSpice.score) : null,
    tropes: b.tropes.map((t) => t.name),
  }));

  return NextResponse.json({ books: shaped });
}
