import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { setReaderResponse } from "@/lib/reading-status";
import { createHotlist, addBookToHotlist } from "@/lib/hotlists";
import type { ReaderResponse } from "@/lib/types";

const VALID_RESPONSES: ReaderResponse[] = [
  "must_read", "on_the_shelf", "not_for_me",
  "loved_it", "it_was_fine", "didnt_finish",
];

// Search creators by handle
const searchSchema = z.object({
  action: z.literal("search"),
  query: z.string().min(1).max(100),
});

// Get top books from selected creators
const booksSchema = z.object({
  action: z.literal("books"),
  creatorIds: z.array(z.string().uuid()).min(1).max(20),
});

// Apply responses
const applySchema = z.object({
  action: z.literal("apply"),
  creatorIds: z.array(z.string().uuid()).min(1).max(20),
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
  const body = await request.json();

  // Search doesn't require auth
  if (body.action === "search") {
    const parsed = searchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const admin = getAdminClient();
    const q = parsed.data.query.toLowerCase();

    const { data: creators } = await admin
      .from("creator_handles")
      .select("id, handle, platform, book_count, grab_count")
      .or(`handle.ilike.%${q}%`)
      .gt("book_count", 0)
      .order("book_count", { ascending: false })
      .limit(15);

    return NextResponse.json({
      ok: true,
      creators: (creators ?? []).map((c) => ({
        id: c.id,
        handle: c.handle,
        platform: c.platform,
        bookCount: c.book_count,
        grabCount: c.grab_count,
      })),
    });
  }

  // Get top books from selected creators
  if (body.action === "books") {
    const parsed = booksSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const admin = getAdminClient();

    // Get all book mentions from these creators
    const { data: mentions } = await admin
      .from("creator_book_mentions")
      .select("book_id")
      .in("creator_handle_id", parsed.data.creatorIds);

    // Count overlap — books mentioned by multiple selected creators rank higher
    const bookCounts = new Map<string, number>();
    for (const m of mentions ?? []) {
      const id = m.book_id as string;
      bookCounts.set(id, (bookCounts.get(id) ?? 0) + 1);
    }

    // Sort by overlap count DESC, take top 20
    const topBookIds = Array.from(bookCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id]) => id);

    if (topBookIds.length === 0) {
      return NextResponse.json({ ok: true, books: [] });
    }

    // Fetch book details
    const { data: books } = await admin
      .from("books")
      .select("id, title, author, cover_url, slug")
      .in("id", topBookIds)
      .eq("is_canon", true);

    // Re-sort by overlap count
    const bookMap = new Map((books ?? []).map((b) => [b.id as string, b]));
    const sorted = topBookIds
      .map((id) => bookMap.get(id))
      .filter((b): b is NonNullable<typeof b> => !!b);

    return NextResponse.json({
      ok: true,
      books: sorted.map((b) => ({
        id: b.id,
        title: b.title,
        author: b.author,
        coverUrl: b.cover_url,
        slug: b.slug,
        overlapCount: bookCounts.get(b.id as string) ?? 0,
      })),
    });
  }

  // Apply responses — requires auth
  if (body.action === "apply") {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = applySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const { creatorIds, responses } = parsed.data;

    // Follow the selected creators
    for (const creatorId of creatorIds) {
      await supabase
        .from("user_follows")
        .upsert(
          { user_id: user.id, creator_handle_id: creatorId },
          { onConflict: "user_id,creator_handle_id" }
        );
    }

    // Set reader responses
    const mustReadBookIds: string[] = [];
    for (const { bookId, response } of responses) {
      await setReaderResponse(user.id, bookId, response as ReaderResponse);
      if (response === "must_read" || response === "loved_it") {
        mustReadBookIds.push(bookId);
      }
    }

    // Auto-create hotlist
    let hotlistId: string | null = null;
    if (mustReadBookIds.length > 0) {
      const hotlist = await createHotlist(
        supabase,
        user.id,
        "Creator Picks"
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
      followCount: creatorIds.length,
      hotlistId,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
