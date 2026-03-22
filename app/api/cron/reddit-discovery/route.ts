/**
 * CRON JOB — Reddit Buzz Discovery
 *
 * Scans r/RomanceBooks, r/Romantasy, r/romancelandia, r/Fantasy
 * for book mentions. Uses Haiku to extract titles from snippets,
 * resolves via Goodreads, saves new books to DB.
 *
 * Cost: ~$0.05 per run.
 * Schedule: Fridays at 6 AM UTC.
 */

import { NextRequest, NextResponse } from "next/server";
import { discoverRedditBuzz } from "@/lib/books/reddit-discovery";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TIME_BUDGET_MS = 240_000;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const isDev = process.env.NODE_ENV === "development";
  if (!isDev && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const logs: string[] = [];

  try {
    const progress = await discoverRedditBuzz(TIME_BUDGET_MS, (msg) => {
      logs.push(msg);
      console.log(msg);
    });

    return NextResponse.json({
      status: "completed",
      ...progress,
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
