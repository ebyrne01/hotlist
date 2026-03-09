import { scheduleEnrichment } from "@/lib/scraping";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const enrichSchema = z.object({
  bookId: z.string().uuid(),
  title: z.string().min(1),
  author: z.string().min(1),
  isbn: z.string().optional(),
});

export async function POST(request: NextRequest) {
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
