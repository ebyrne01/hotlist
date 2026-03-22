import { queueEnrichmentJobs } from "@/lib/enrichment/queue";
import { getAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// In-memory rate limiter: 10 requests per IP per minute
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(ip) ?? [];
  // Remove timestamps older than the window
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(ip, recent);
    return true;
  }

  recent.push(now);
  rateLimitMap.set(ip, recent);
  return false;
}

const enrichSchema = z.object({
  bookId: z.string().uuid(),
  title: z.string().min(1),
  author: z.string().min(1),
  isbn: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429 }
    );
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

    return NextResponse.json({ status: "enrichment_started", bookId });
  } catch {
    return NextResponse.json(
      { error: "Failed to start enrichment" },
      { status: 500 }
    );
  }
}
