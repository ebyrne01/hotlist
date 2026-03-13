/**
 * POST /api/books/refresh-batch
 *
 * Returns fresh hydrated book data for a list of book IDs.
 * Used by HotlistDetailClient to poll for enrichment updates
 * so ratings/spice/tropes appear without a page refresh.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { hydrateBookDetail } from "@/lib/books/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  bookIds: z.array(z.string().uuid()).min(1).max(50),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { bookIds } = parsed.data;
    const supabase = getAdminClient();

    // Fetch raw book rows
    const { data: rows } = await supabase
      .from("books")
      .select("*")
      .in("id", bookIds);

    if (!rows || rows.length === 0) {
      return NextResponse.json({ books: {} });
    }

    // Hydrate each book with ratings, spice, tropes
    const books: Record<string, unknown> = {};
    await Promise.all(
      rows.map(async (row: Record<string, unknown>) => {
        const detail = await hydrateBookDetail(supabase, row);
        books[row.id as string] = detail;
      })
    );

    return NextResponse.json({ books });
  } catch {
    return NextResponse.json(
      { error: "Failed to refresh books" },
      { status: 500 }
    );
  }
}
