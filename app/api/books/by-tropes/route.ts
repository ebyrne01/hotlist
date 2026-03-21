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

  // For a single trope, fetch book_tropes directly with a limit.
  // For multiple tropes, find the intersection (books matching ALL).
  let matchingBookIds: string[] = [];

  if (tropeIds.length === 1) {
    // Single trope — simple query with limit
    const { data: bookTropes } = await supabase
      .from("book_tropes")
      .select("book_id")
      .eq("trope_id", tropeIds[0])
      .limit(50);

    matchingBookIds = (bookTropes ?? []).map((bt) => bt.book_id as string);
  } else {
    // Multiple tropes — intersection query
    // Fetch book_tropes for each trope separately, then intersect in JS
    const allSets: Set<string>[] = [];
    for (const tropeId of tropeIds) {
      const { data: bt } = await supabase
        .from("book_tropes")
        .select("book_id")
        .eq("trope_id", tropeId);
      allSets.push(new Set((bt ?? []).map((r) => r.book_id as string)));
    }

    // Intersect: keep only book IDs present in ALL sets
    if (allSets.length > 0) {
      const [first, ...rest] = allSets;
      matchingBookIds = Array.from(first).filter((id) =>
        rest.every((s) => s.has(id))
      );
    }
  }

  if (matchingBookIds.length === 0) {
    return NextResponse.json({ books: [] });
  }

  // Fetch and hydrate matching books (limit to 50 for response size)
  const { data: dbBooks } = await supabase
    .from("books")
    .select("*")
    .in("id", matchingBookIds.slice(0, 50))
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
