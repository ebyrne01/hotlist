/**
 * One-time utility — Re-queue Amazon rating lookups for books missing them.
 *
 * Finds books that completed enrichment but have no Amazon rating in book_ratings,
 * and inserts fresh amazon_rating jobs into the enrichment queue.
 *
 * Trigger manually: curl -H "Authorization: Bearer $CRON_SECRET" https://hotlist.app/api/cron/requeue-amazon
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth, cronUnauthorized } from "@/lib/api/cron-auth";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request)) {
    return cronUnauthorized();
  }

  const supabase = getAdminClient();

  // Find books that have NO amazon rating in book_ratings
  // and don't already have a pending amazon_rating job
  const { data: booksWithoutAmazon, error: queryError } = await supabase
    .rpc("get_books_missing_amazon_rating");

  if (queryError) {
    // Fallback: manual query if RPC doesn't exist
    // Get all book IDs that DO have an Amazon rating
    const { data: withAmazon } = await supabase
      .from("book_ratings")
      .select("book_id")
      .eq("source", "amazon");

    const amazonBookIds = new Set((withAmazon ?? []).map((r) => r.book_id));

    // Get all books
    const { data: allBooks } = await supabase
      .from("books")
      .select("id, title, author")
      .in("enrichment_status", ["partial", "complete"]);

    const missing = (allBooks ?? []).filter((b) => !amazonBookIds.has(b.id));

    // Get pending amazon_rating jobs to avoid duplicates
    const { data: pendingJobs } = await supabase
      .from("enrichment_queue")
      .select("book_id")
      .eq("job_type", "amazon_rating")
      .in("status", ["pending", "processing"]);

    const pendingIds = new Set((pendingJobs ?? []).map((j) => j.book_id));
    const toQueue = missing.filter((b) => !pendingIds.has(b.id));

    // Insert jobs in batches of 100
    let queued = 0;
    for (let i = 0; i < toQueue.length; i += 100) {
      const batch = toQueue.slice(i, i + 100).map((b) => ({
        book_id: b.id,
        job_type: "amazon_rating" as const,
        status: "pending" as const,
        attempts: 0,
        created_at: new Date().toISOString(),
      }));

      const { error: insertError } = await supabase
        .from("enrichment_queue")
        .upsert(batch, { onConflict: "book_id,job_type" });

      if (!insertError) {
        queued += batch.length;
      }
    }

    return NextResponse.json({
      status: "completed",
      books_missing_amazon: missing.length,
      already_pending: pendingIds.size,
      jobs_queued: queued,
    });
  }

  return NextResponse.json({
    status: "completed",
    message: "Used RPC",
    count: booksWithoutAmazon?.length ?? 0,
  });
}
