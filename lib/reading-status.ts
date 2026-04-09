import { createClient } from "@/lib/supabase/client";
import type { ReadingStatus, ReaderResponse } from "@/lib/types";
import { isPostRead } from "@/lib/types";

// ── Legacy API (still works, dual-writes) ───────────

/**
 * Get the current reading status for a user + book pair.
 * Returns both legacy status and new response/is_reading fields.
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
 * Dual-writes both old `status` and new `response` + `is_reading`.
 */
export async function setReadingStatus(
  userId: string,
  bookId: string,
  status: ReadingStatus
): Promise<void> {
  const supabase = createClient();

  // Map old status → new response
  const responseMap: Record<ReadingStatus, ReaderResponse> = {
    want_to_read: "on_the_shelf",
    reading: "on_the_shelf", // reading is now a boolean, default pre-read to on_the_shelf
    read: "loved_it",
  };

  await supabase.from("reading_status").upsert(
    {
      user_id: userId,
      book_id: bookId,
      status,
      response: responseMap[status],
      is_reading: status === "reading",
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

// ── New Response API ────────────────────────────────

export interface ReaderResponseState {
  response: ReaderResponse | null;
  isReading: boolean;
}

/**
 * Get the current reader response for a user + book pair.
 */
export async function getReaderResponse(
  userId: string,
  bookId: string
): Promise<ReaderResponseState | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("reading_status")
    .select("response, is_reading")
    .eq("user_id", userId)
    .eq("book_id", bookId)
    .single();

  if (!data) return null;

  return {
    response: (data.response as ReaderResponse) ?? null,
    isReading: data.is_reading as boolean,
  };
}

/**
 * Set the reader response for a user + book pair.
 * Handles mutual exclusivity: post-read clears is_reading,
 * pre-read clears any post-read.
 * Dual-writes old `status` column for backward compatibility.
 */
export async function setReaderResponse(
  userId: string,
  bookId: string,
  response: ReaderResponse,
  isReading?: boolean
): Promise<void> {
  const supabase = createClient();

  // Map new response → old status for dual-write
  const statusMap: Record<ReaderResponse, ReadingStatus> = {
    must_read: "want_to_read",
    on_the_shelf: "want_to_read",
    not_for_me: "want_to_read",
    loved_it: "read",
    it_was_fine: "read",
    didnt_finish: "read",
  };

  // Post-read responses always clear is_reading
  const finalIsReading = isPostRead(response)
    ? false
    : isReading ?? false;

  await supabase.from("reading_status").upsert(
    {
      user_id: userId,
      book_id: bookId,
      status: statusMap[response],
      response,
      is_reading: finalIsReading,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,book_id" }
  );
}

/**
 * Toggle the is_reading boolean without changing the response.
 */
export async function toggleReading(
  userId: string,
  bookId: string,
  isReading: boolean
): Promise<void> {
  const supabase = createClient();

  // Check if row exists
  const { data: existing } = await supabase
    .from("reading_status")
    .select("response")
    .eq("user_id", userId)
    .eq("book_id", bookId)
    .single();

  if (existing) {
    await supabase
      .from("reading_status")
      .update({
        is_reading: isReading,
        status: isReading ? "reading" : (existing.response === "on_the_shelf" || existing.response === "must_read" ? "want_to_read" : "read"),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("book_id", bookId);
  } else {
    // No row yet — create one with on_the_shelf + reading
    await supabase.from("reading_status").insert({
      user_id: userId,
      book_id: bookId,
      status: isReading ? "reading" : "want_to_read",
      response: "on_the_shelf",
      is_reading: isReading,
      updated_at: new Date().toISOString(),
    });
  }
}

/**
 * Clear the reader response (undo). Deletes the row entirely.
 */
export async function clearReaderResponse(
  userId: string,
  bookId: string
): Promise<void> {
  return removeReadingStatus(userId, bookId);
}
