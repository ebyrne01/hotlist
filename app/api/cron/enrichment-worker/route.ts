import { NextResponse } from "next/server";
import { processEnrichmentQueue } from "@/lib/enrichment/worker";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel Pro: up to 300s

export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 240s time budget (60s buffer for Vercel's 300s Pro limit)
    const result = await processEnrichmentQueue(240_000);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/enrichment-worker] Fatal error:", error);
    return NextResponse.json(
      { error: "Enrichment worker failed" },
      { status: 500 }
    );
  }
}
