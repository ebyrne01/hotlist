import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { setReaderResponse } from "@/lib/reading-status";
import { createHotlist, addBookToHotlist } from "@/lib/hotlists";
import type { ReaderResponse } from "@/lib/types";

const VALID_RESPONSES: ReaderResponse[] = [
  "must_read", "on_the_shelf", "not_for_me",
  "loved_it", "it_was_fine", "didnt_finish",
];

const schema = z.object({
  responses: z
    .array(
      z.object({
        bookId: z.string().uuid(),
        response: z.enum(VALID_RESPONSES as [string, ...string[]]),
      })
    )
    .min(1)
    .max(100),
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
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { responses } = parsed.data;

  // Set all responses
  const mustReadBookIds: string[] = [];
  for (const { bookId, response } of responses) {
    await setReaderResponse(user.id, bookId, response as ReaderResponse);
    if (response === "must_read") {
      mustReadBookIds.push(bookId);
    }
  }

  // Auto-create hotlist from must_read picks
  let hotlistId: string | null = null;
  if (mustReadBookIds.length > 0) {
    const hotlist = await createHotlist(supabase, user.id, "My Must Reads");
    if (hotlist) {
      hotlistId = hotlist.id;
      for (const bookId of mustReadBookIds) {
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
