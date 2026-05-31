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
const P0_LIMIT = 250;

type P0Target = { book_id: string };

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request)) {
    return cronUnauthorized();
  }

  const supabase = getAdminClient();

  const { data: p0Targets, error: p0Error } = await supabase.rpc(
    "get_p0_canon_enrichment_targets",
    { p_limit: P0_LIMIT }
  );

  if (p0Error || !p0Targets) {
    return NextResponse.json(
      { error: "Could not load P0 canon enrichment targets" },
      { status: 500 }
    );
  }

  const p0Ids = (p0Targets as P0Target[]).map((target) => target.book_id);

  if (p0Ids.length === 0) {
    return NextResponse.json({
      status: "completed",
      scope: "p0_canon",
      p0_targets: 0,
      jobs_queued: 0,
    });
  }

  const [{ data: withAmazon }, { data: activeJobs }] = await Promise.all([
    supabase
      .from("book_ratings")
      .select("book_id")
      .eq("source", "amazon")
      .in("book_id", p0Ids),
    supabase
      .from("enrichment_queue")
      .select("book_id")
      .eq("job_type", "amazon_rating")
      .in("status", ["pending", "running"])
      .in("book_id", p0Ids),
  ]);

  const withAmazonIds = new Set((withAmazon ?? []).map((row) => row.book_id));
  const activeJobIds = new Set((activeJobs ?? []).map((row) => row.book_id));
  const toQueue = p0Ids.filter(
    (id) => !withAmazonIds.has(id) && !activeJobIds.has(id)
  );

  const now = new Date().toISOString();
  const rows = toQueue.map((bookId) => ({
    book_id: bookId,
    job_type: "amazon_rating" as const,
    status: "pending" as const,
    attempts: 0,
    max_attempts: 5,
    next_retry_at: now,
    error_message: null,
    outcome: null,
    updated_at: now,
  }));

  if (rows.length > 0) {
    await supabase
      .from("enrichment_queue")
      .upsert(rows, { onConflict: "book_id,job_type" });
  }

  return NextResponse.json({
    status: "completed",
    scope: "p0_canon",
    p0_targets: p0Ids.length,
    already_has_amazon: withAmazonIds.size,
    already_active: activeJobIds.size,
    jobs_queued: rows.length,
  });
}
