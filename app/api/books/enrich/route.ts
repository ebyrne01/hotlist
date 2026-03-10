import { scheduleEnrichment } from "@/lib/scraping";
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

    const { bookId, title, author, isbn } = parsed.data;

    // Fire and forget — returns immediately
    scheduleEnrichment(bookId, title, author, isbn);

    return NextResponse.json({ status: "enrichment_started", bookId });
  } catch {
    return NextResponse.json(
      { error: "Failed to start enrichment" },
      { status: 500 }
    );
  }
}
