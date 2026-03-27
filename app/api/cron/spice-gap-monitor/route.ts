/**
 * CRON JOB — Spice Gap Monitor
 *
 * Monthly audit that identifies and fixes spice data gaps:
 * zero-spice books, top books missing romance.io, hierarchy
 * violations, and genre-bucketing-only upgrades.
 *
 * Cost: ~$1/run (mostly romance.io Serper re-queries).
 * Schedule: 1st of each month at 3 AM UTC.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth, cronUnauthorized } from "@/lib/api/cron-auth";
import { runSpiceGapAudit } from "@/lib/books/spice-gap-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request)) {
    return cronUnauthorized();
  }

  const startTime = Date.now();
  const logs: string[] = [];

  try {
    const result = await runSpiceGapAudit((msg) => {
      logs.push(msg);
      console.log(msg);
    });

    return NextResponse.json({
      status: "completed",
      ...result,
      logs,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "failed",
        error: String(err),
        logs,
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
