import { NextResponse } from "next/server";
import { processEnrichmentQueue } from "@/lib/enrichment/worker";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 50s time budget (10s buffer for Vercel's 60s limit)
    const result = await processEnrichmentQueue(50_000);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/enrichment-worker] Fatal error:", error);
    return NextResponse.json(
      { error: "Enrichment worker failed" },
      { status: 500 }
    );
  }
}
