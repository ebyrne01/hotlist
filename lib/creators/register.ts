/**
 * Register a creator handle and their book mentions from a video grab.
 * Called after every successful grab. Idempotent (upserts).
 */

import { getAdminClient } from "@/lib/supabase/admin";
import type { ResolvedBook } from "@/lib/video/book-resolver";

interface RegisterInput {
  handle: string;
  platform: "tiktok" | "instagram" | "youtube";
  videoUrl: string;
  videoGrabId: string;
  books: ResolvedBook[];
}

export async function registerCreatorMentions(input: RegisterInput): Promise<void> {
  const supabase = getAdminClient();
  const normalizedHandle = input.handle.startsWith("@") ? input.handle : `@${input.handle}`;

  // Upsert creator handle — atomic grab_count increment
  const { data: existing } = await supabase
    .from("creator_handles")
    .select("id")
    .eq("handle", normalizedHandle)
    .eq("platform", input.platform)
    .single();

  let creatorId: string;

  if (existing) {
    // Atomic increment
    await supabase
      .from("creator_handles")
      .update({ last_grabbed_at: new Date().toISOString() })
      .eq("id", existing.id);
    await supabase.rpc("increment_grab_count", { handle_id: existing.id });
    creatorId = existing.id;
  } else {
    const { data: created } = await supabase
      .from("creator_handles")
      .insert({
        handle: normalizedHandle,
        platform: input.platform,
        grab_count: 1,
        last_grabbed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (!created) return;
    creatorId = created.id;
  }

  // Batch insert book mentions
  const matchedBooks = input.books.filter(
    (b): b is Extract<typeof b, { matched: true }> => b.matched
  );

  if (matchedBooks.length > 0) {
    const mentionRows = matchedBooks.map((book) => ({
      creator_handle_id: creatorId,
      book_id: book.book.id,
      video_grab_id: input.videoGrabId,
      sentiment: book.creatorSentiment || null,
      quote: book.creatorQuote || null,
      platform: input.platform,
      video_url: input.videoUrl,
    }));

    await supabase
      .from("creator_book_mentions")
      .upsert(mentionRows, { onConflict: "creator_handle_id,book_id,video_grab_id" });
  }

  // Update book_count
  const { count } = await supabase
    .from("creator_book_mentions")
    .select("book_id", { count: "exact", head: true })
    .eq("creator_handle_id", creatorId);

  await supabase
    .from("creator_handles")
    .update({ book_count: count || 0 })
    .eq("id", creatorId);
}
