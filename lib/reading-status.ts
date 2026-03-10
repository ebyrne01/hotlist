import { createClient } from "@/lib/supabase/client";
import type { ReadingStatus, BookDetail } from "@/lib/types";

/**
 * Get the current reading status for a user + book pair.
 */
export async function getReadingStatus(
  userId: string,
  bookId: string
): Promise<ReadingStatus | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("reading_status")
    .select("status")
    .eq("user_id", userId)
    .eq("book_id", bookId)
    .single();

  return (data?.status as ReadingStatus) ?? null;
}

/**
 * Set (upsert) the reading status for a user + book pair.
 */
export async function setReadingStatus(
  userId: string,
  bookId: string,
  status: ReadingStatus
): Promise<void> {
  const supabase = createClient();
  await supabase.from("reading_status").upsert(
    {
      user_id: userId,
      book_id: bookId,
      status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,book_id" }
  );
}

/**
 * Remove reading status entirely for a user + book pair.
 */
export async function removeReadingStatus(
  userId: string,
  bookId: string
): Promise<void> {
  const supabase = createClient();
  await supabase
    .from("reading_status")
    .delete()
    .eq("user_id", userId)
    .eq("book_id", bookId);
}
