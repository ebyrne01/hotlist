import { queueEnrichmentJobs } from "@/lib/enrichment/queue";
import { getAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  checkRateLimit,
  rateLimitHeaders,
  rateLimitResponse,
} from "@/lib/api/rate-limit";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SECONDS = 60;

const enrichSchema = z.object({
  bookId: z.string().uuid(),
  title: z.string().min(1),
  author: z.string().min(1),
  isbn: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const rateLimit = await checkRateLimit(request, {
    bucket: "books:enrich",
    limit: RATE_LIMIT_MAX,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit, RATE_LIMIT_MAX);
  }

  try {
    const body = await request.json();
    const parsed = enrichSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { bookId, title, author } = parsed.data;

    // Check if this book already has enrichment queue jobs
    const supabase = getAdminClient();
    const { data: existingJobs } = await supabase
      .from("enrichment_queue")
      .select("id")
      .eq("book_id", bookId)
      .limit(1);

    if (!existingJobs || existingJobs.length === 0) {
      // No queue jobs exist — this book predates the enrichment queue.
      await queueEnrichmentJobs(bookId, title, author);
    }

    return NextResponse.json(
      { status: "enrichment_started", bookId },
      { headers: rateLimitHeaders(rateLimit, RATE_LIMIT_MAX) }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to start enrichment" },
      { status: 500 }
    );
  }
}
