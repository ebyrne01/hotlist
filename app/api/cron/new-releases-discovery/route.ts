/**
 * CRON JOB — Daily New Releases Discovery
 *
 * Runs daily at 5am UTC.
 * Fetches recent romance/romantasy releases from Google Books,
 * saves new books to cache, and queues enrichment.
 */

import { NextRequest, NextResponse } from "next/server";
import { getRomanceNewReleases } from "@/lib/books/new-releases";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const isDev = process.env.NODE_ENV === "development";
  if (!isDev && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const books = await getRomanceNewReleases();

    return NextResponse.json({
      status: "completed",
      books_discovered: books.length,
      titles: books.slice(0, 5).map((b) => b.title),
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "failed",
        error: String(err),
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
