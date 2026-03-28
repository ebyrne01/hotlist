import { NextResponse } from "next/server";
import { requireCronAuth, cronUnauthorized } from "@/lib/api/cron-auth";
import { runDataHygiene } from "@/lib/books/data-hygiene";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Data hygiene cron — junk removal, dedup, user ref migration.
 * Runs Sundays 2 AM UTC. Quality pipeline runs separately at 3 AM.
 */
export async function GET(request: Request) {
  if (!requireCronAuth(request)) {
    return cronUnauthorized();
  }

  try {
    const hygiene = await runDataHygiene();
    console.log(
      `[data-hygiene] Cleaned ${hygiene.deleted} junk entries, migrated ${hygiene.migrated} user refs, skipped ${hygiene.skippedWithUserData.length}`
    );
    if (hygiene.details.length > 0) {
      console.log(`[data-hygiene] Details:`, hygiene.details.join("; "));
    }
    if (hygiene.skippedWithUserData.length > 0) {
      console.log(
        `[data-hygiene] Skipped (has user data):`,
        hygiene.skippedWithUserData.join("; ")
      );
    }

    // Enrichment queue cleanup
    const supabase = getAdminClient();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Delete completed jobs older than 30 days
    const { count: deletedCompleted } = await supabase
      .from("enrichment_queue")
      .delete({ count: "exact" })
      .eq("status", "completed")
      .lt("updated_at", thirtyDaysAgo);

    console.log(`[data-hygiene] Cleaned ${deletedCompleted ?? 0} completed enrichment jobs older than 30 days`);

    // Archive dead-letter jobs (exceeded max retries)
    const { data: deadLetters } = await supabase
      .from("enrichment_queue")
      .select("id, book_id, job_type, error_message, attempts")
      .eq("status", "failed")
      .gte("attempts", 5);

    if (deadLetters && deadLetters.length > 0) {
      console.warn(`[data-hygiene] ${deadLetters.length} dead-letter enrichment jobs:`);
      for (const dl of deadLetters.slice(0, 10)) {
        console.warn(`  - ${dl.job_type} for book ${dl.book_id}: ${dl.error_message}`);
      }

      await supabase
        .from("enrichment_queue")
        .update({ status: "dead_letter" })
        .eq("status", "failed")
        .gte("attempts", 5);
    }

    return NextResponse.json({ hygiene, queueCleanup: { deletedCompleted: deletedCompleted ?? 0, deadLetters: deadLetters?.length ?? 0 } });
  } catch (error) {
    console.error("[cron/data-hygiene] Fatal error:", error);
    return NextResponse.json(
      { error: "Data hygiene failed" },
      { status: 500 }
    );
  }
}
