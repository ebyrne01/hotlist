import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { parseGoodreadsCsv } from "@/lib/import/goodreads-csv";
import { matchImportedBooks } from "@/lib/import/book-matcher";
import { setReaderResponse } from "@/lib/reading-status";
import { createHotlist, addBookToHotlist } from "@/lib/hotlists";
import type { ReaderResponse } from "@/lib/types";

const VALID_RESPONSES: ReaderResponse[] = [
  "must_read", "on_the_shelf", "not_for_me",
  "loved_it", "it_was_fine", "didnt_finish",
];

// Step 1: Parse CSV and match books
const matchSchema = z.object({
  action: z.literal("match"),
  csvText: z.string().min(10).max(5_000_000),
});

// Step 2: Apply responses
const applySchema = z.object({
  action: z.literal("apply"),
  responses: z
    .array(
      z.object({
        bookId: z.string().uuid(),
        response: z.enum(VALID_RESPONSES as [string, ...string[]]),
      })
    )
    .min(1)
    .max(500),
});

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  // Route by action
  if (body.action === "match") {
    const parsed = matchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const imports = parseGoodreadsCsv(parsed.data.csvText);
    if (imports.length === 0) {
      return NextResponse.json(
        { error: "No books found in CSV. Make sure it's a Goodreads export." },
        { status: 400 }
      );
    }

    const matched = await matchImportedBooks(imports);

    return NextResponse.json({
      ok: true,
      totalImported: imports.length,
      matched: matched.filter((m) => m.bookId !== null).length,
      unmatched: matched.filter((m) => m.bookId === null).length,
      books: matched.map((m) => ({
        importIndex: m.importIndex,
        bookId: m.bookId,
        title: m.title,
        author: m.author,
        coverUrl: m.coverUrl,
        matchMethod: m.matchMethod,
        proposedResponse: m.proposedResponse,
        shelf: m.goodreadsImport.shelf,
        rating: m.goodreadsImport.rating,
      })),
    });
  }

  if (body.action === "apply") {
    const parsed = applySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { responses } = parsed.data;
    const mustReadBookIds: string[] = [];

    for (const { bookId, response } of responses) {
      await setReaderResponse(user.id, bookId, response as ReaderResponse);
      if (response === "must_read" || response === "loved_it") {
        mustReadBookIds.push(bookId);
      }
    }

    // Auto-create hotlist from must_read + loved_it picks
    let hotlistId: string | null = null;
    if (mustReadBookIds.length > 0) {
      const hotlist = await createHotlist(
        supabase,
        user.id,
        "My Goodreads Favorites"
      );
      if (hotlist) {
        hotlistId = hotlist.id;
        for (const bookId of mustReadBookIds.slice(0, 20)) {
          await addBookToHotlist(supabase, hotlist.id, bookId);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      responseCount: responses.length,
      hotlistId,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
