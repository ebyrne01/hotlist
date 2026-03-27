/**
 * POST /api/books/refresh-batch
 *
 * Returns fresh hydrated book data for a list of book IDs.
 * Used by HotlistDetailClient to poll for enrichment updates
 * so ratings/spice/tropes appear without a page refresh.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { hydrateBookDetailBatch } from "@/lib/books/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkOrigin } from "@/lib/api/cors";

const schema = z.object({
  bookIds: z.array(z.string().uuid()).min(1).max(20),
});

export async function POST(request: NextRequest) {
  if (!checkOrigin(request)) {
    return NextResponse.json({ error: "Unauthorized origin" }, { status: 403 });
  }

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

    // Batch-hydrate all books (4 queries total instead of 4 per book)
    const detailMap = await hydrateBookDetailBatch(supabase, rows as Record<string, unknown>[]);
    const books: Record<string, unknown> = {};
    detailMap.forEach((detail, id) => { books[id] = detail; });

    return NextResponse.json({ books });
  } catch {
    return NextResponse.json(
      { error: "Failed to refresh books" },
      { status: 500 }
    );
  }
}
