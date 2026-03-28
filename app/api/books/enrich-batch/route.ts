import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { queueEnrichmentJobs } from "@/lib/enrichment/queue";
import { isJunkTitle } from "@/lib/books/romance-filter";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes for Vercel

export async function POST(request: NextRequest) {
  // Auth: only in dev or with service role key
  const isDev = process.env.NODE_ENV === "development";
  const authHeader = request.headers.get("authorization");
  const isAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isDev && !isAuthorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";

  const supabase = getAdminClient();

  // Find legitimate books that need enrichment:
  // - Has a real goodreads_id (not placeholder)
  // - Has no Goodreads rating yet (unless force=true)
  // - Title isn't junk
  const { data: books } = await supabase
    .from("books")
    .select("id, title, author, isbn, goodreads_id")
    .not("goodreads_id", "like", "unknown-%")
    .order("created_at", { ascending: false });

  if (!books || books.length === 0) {
    return NextResponse.json({ queued: 0, message: "No books need enrichment" });
  }

  let needsEnrichment: typeof books;

  if (force) {
    // Re-enrich all books regardless of existing ratings
    needsEnrichment = books.filter((b) => !isJunkTitle(b.title));
  } else {
    // Check which books already have Goodreads ratings
    const bookIds = books.map((b) => b.id);
    const { data: existingRatings } = await supabase
      .from("book_ratings")
      .select("book_id")
      .in("book_id", bookIds)
      .eq("source", "goodreads")
      .not("rating", "is", null);

    const hasRating = new Set((existingRatings ?? []).map((r: Record<string, unknown>) => r.book_id as string));

    // Filter to books needing enrichment
    needsEnrichment = books.filter((b) =>
      !hasRating.has(b.id) && !isJunkTitle(b.title)
    );
  }

  // Process in batches of 10
  const BATCH_SIZE = 10;
  let queued = 0;

  for (let i = 0; i < needsEnrichment.length; i += BATCH_SIZE) {
    const batch = needsEnrichment.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((book) => queueEnrichmentJobs(book.id, book.title, book.author))
    );
    queued += batch.length;
  }

  return NextResponse.json({
    queued,
    total_books: books.length,
    already_enriched: books.length - needsEnrichment.length,
    message: `Queued ${queued} books for enrichment in ${Math.ceil(needsEnrichment.length / BATCH_SIZE)} batches`
  });
}
