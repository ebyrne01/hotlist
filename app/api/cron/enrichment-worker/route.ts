import { NextResponse } from "next/server";
import { requireCronAuth, cronUnauthorized } from "@/lib/api/cron-auth";
import { processEnrichmentQueue } from "@/lib/enrichment/worker";
import { computeSourceHealth } from "@/lib/enrichment/health-check";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel Pro: up to 300s

export async function GET(request: Request) {
  if (!requireCronAuth(request)) {
    return cronUnauthorized();
  }

  try {
    // Log queue depth before processing
    const supabase = getAdminClient();
    const [{ count: pendingCount }, { count: failedCount }] = await Promise.all([
      supabase.from("enrichment_queue").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("enrichment_queue").select("*", { count: "exact", head: true }).eq("status", "failed"),
    ]);
    console.log(`[enrichment-worker] Queue depth: ${pendingCount ?? 0} pending, ${failedCount ?? 0} failed`);
    if ((pendingCount ?? 0) > 1000) {
      console.warn(`[enrichment-worker] WARNING: Queue depth exceeds 1000 pending jobs`);
    }

    // 240s time budget (60s buffer for Vercel's 300s Pro limit)
    const result = await processEnrichmentQueue(240_000);

    // Append source health to the cron response (visible in Vercel logs)
    const health = await computeSourceHealth(24);

    return NextResponse.json({ ...result, health });
  } catch (error) {
    console.error("[cron/enrichment-worker] Fatal error:", error);
    return NextResponse.json(
      { error: "Enrichment worker failed" },
      { status: 500 }
    );
  }
}
