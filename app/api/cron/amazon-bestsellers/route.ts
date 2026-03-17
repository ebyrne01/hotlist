/**
 * CRON JOB — Amazon Bestseller Discovery
 *
 * Discovers new romance books from Amazon bestseller lists via Serper.
 * Runs daily, resolves titles through Goodreads, saves to DB.
 *
 * Cost: ~$0.005 per run (5 Serper queries).
 */

import { NextRequest, NextResponse } from "next/server";
import { discoverAmazonBestsellers } from "@/lib/books/amazon-bestseller-discovery";

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
    const progress = await discoverAmazonBestsellers(
      TIME_BUDGET_MS,
      (msg) => {
        logs.push(msg);
        console.log(msg);
      }
    );

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
