/**
 * POST /api/books/refresh-spice
 *
 * Triggers community spice aggregation for a single book.
 * Called after a user saves a spice rating (fire-and-forget from client).
 * Also usable by admins to force-refresh any book's spice signals.
 *
 * Body: { bookId: string }
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { aggregateCommunitySpice } from "@/lib/spice/community-aggregation";
import { getCompositeSpice } from "@/lib/spice/compute-composite";

const bodySchema = z.object({
  bookId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { bookId } = bodySchema.parse(body);

    // Aggregate community ratings into spice_signals
    const signal = await aggregateCommunitySpice(bookId);

    // Recompute composite (for logging; the composite is always computed fresh on read)
    const composite = await getCompositeSpice(bookId);

    return NextResponse.json({
      ok: true,
      bookId,
      communitySignal: signal
        ? {
            spiceValue: signal.spiceValue,
            confidence: signal.confidence,
            ratingCount: signal.ratingCount,
          }
        : null,
      composite: composite
        ? {
            score: composite.score,
            primarySource: composite.primarySource,
            conflictFlag: composite.conflictFlag,
          }
        : null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: err.issues },
        { status: 400 }
      );
    }
    console.error("[refresh-spice] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
