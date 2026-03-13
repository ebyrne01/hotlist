/**
 * BACKFILL: Creator Handles from Video Grabs
 *
 * Reads all video_grabs with a creator_handle, upserts into
 * creator_handles, and denormalizes book mentions into
 * creator_book_mentions.
 *
 * Run once: npx tsx scripts/backfill-creator-handles.ts
 */

import { getAdminClient } from "@/lib/supabase/admin";

async function backfill() {
  const supabase = getAdminClient();
  let processed = 0;
  let creatorsUpserted = 0;
  let mentionsCreated = 0;

  // Fetch all grabs with a creator handle
  const { data: grabs } = await supabase
    .from("video_grabs")
    .select("id, url, platform, creator_handle, extracted_books, processed_at")
    .not("creator_handle", "is", null);

  if (!grabs || grabs.length === 0) {
    console.log("No grabs with creator handles found.");
    return;
  }

  console.log(`Processing ${grabs.length} grabs...`);

  for (const grab of grabs) {
    const handle = grab.creator_handle as string;
    const platform = (grab.platform as string) || "tiktok";
    const normalizedHandle = handle.startsWith("@") ? handle : `@${handle}`;
    processed++;

    // Upsert creator handle
    const { data: creator } = await supabase
      .from("creator_handles")
      .upsert(
        {
          handle: normalizedHandle,
          platform,
          last_grabbed_at: grab.processed_at || new Date().toISOString(),
        },
        { onConflict: "handle,platform" }
      )
      .select("id")
      .single();

    if (!creator) {
      console.warn(`  Failed to upsert creator for handle: ${normalizedHandle}`);
      continue;
    }
    creatorsUpserted++;

    // Parse extracted books and create mentions
    const books = grab.extracted_books as any[];
    if (!books || !Array.isArray(books)) continue;

    const mentionRows = books
      .filter((book: any) => book.matched && book.book?.id)
      .map((book: any) => ({
        creator_handle_id: creator.id,
        book_id: book.book.id,
        video_grab_id: grab.id,
        sentiment: book.creatorSentiment || null,
        quote: book.creatorQuote || null,
        platform,
        video_url: grab.url,
      }));

    if (mentionRows.length > 0) {
      const { error } = await supabase
        .from("creator_book_mentions")
        .upsert(mentionRows, { onConflict: "creator_handle_id,book_id,video_grab_id" });

      if (!error) {
        mentionsCreated += mentionRows.length;
      } else {
        console.warn(`  Mention upsert error for grab ${grab.id}:`, error.message);
      }
    }

    console.log(`  [${processed}/${grabs.length}] ${normalizedHandle} — ${mentionRows.length} mentions`);
  }

  // Update aggregate counts
  console.log("\nRefreshing aggregate stats...");
  await supabase.rpc("refresh_creator_handle_stats");

  console.log(`\nDone. Processed: ${processed}, Creators: ${creatorsUpserted}, Mentions: ${mentionsCreated}`);
}

backfill().catch(console.error);
