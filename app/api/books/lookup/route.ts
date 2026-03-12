import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/books/lookup?id=<book_id>
 * Returns the current enrichment status and whether ratings/spice have appeared.
 * Used by the book detail page to poll for enrichment progress.
 */
export async function GET(request: NextRequest) {
  const bookId = request.nextUrl.searchParams.get("id");
  if (!bookId) {
    return NextResponse.json({ error: "Missing id param" }, { status: 400 });
  }

  const supabase = getAdminClient();

  const { data: book } = await supabase
    .from("books")
    .select("id, enrichment_status")
    .eq("id", bookId)
    .single();

  if (!book) {
    return NextResponse.json({ found: false });
  }

  // Check if any ratings or spice data have appeared
  const [ratingsRes, spiceRes] = await Promise.all([
    supabase.from("book_ratings").select("id").eq("book_id", bookId).limit(1),
    supabase.from("book_spice").select("id").eq("book_id", bookId).limit(1),
  ]);

  const hasRatings = (ratingsRes.data?.length ?? 0) > 0;
  const hasSpice = (spiceRes.data?.length ?? 0) > 0;

  return NextResponse.json({
    found: true,
    enrichmentStatus: book.enrichment_status,
    hasRatings,
    hasSpice,
  });
}
