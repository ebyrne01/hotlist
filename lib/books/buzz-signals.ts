/**
 * BUZZ SIGNALS
 *
 * Records buzz events from various sources into the book_buzz_signals table.
 * Used by the buzz scoring system to rank books for "What's Hot" and similar surfaces.
 *
 * Sources: reddit_mention, amazon_bestseller, booktok_grab, nyt_bestseller
 * Deduplication: one signal per book per source per day (via unique index).
 */

import { getAdminClient } from "@/lib/supabase/admin";

export type BuzzSource =
  | "reddit_mention"
  | "amazon_bestseller"
  | "booktok_grab"
  | "nyt_bestseller";

/**
 * Record a buzz signal for a book. Safe to call multiple times —
 * duplicates within the same day are ignored (ON CONFLICT DO NOTHING).
 */
export async function recordBuzzSignal(
  bookId: string,
  source: BuzzSource,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const supabase = getAdminClient();
  await supabase.from("book_buzz_signals").upsert(
    {
      book_id: bookId,
      source,
      signal_date: new Date().toISOString().slice(0, 10),
      metadata,
    },
    { onConflict: "book_id,source,signal_date" }
  );
}

/**
 * Record buzz signals for multiple books at once.
 */
export async function recordBuzzSignalsBatch(
  entries: { bookId: string; source: BuzzSource; metadata?: Record<string, unknown> }[]
): Promise<void> {
  if (entries.length === 0) return;
  const supabase = getAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const rows = entries.map((e) => ({
    book_id: e.bookId,
    source: e.source,
    signal_date: today,
    metadata: e.metadata ?? {},
  }));

  await supabase
    .from("book_buzz_signals")
    .upsert(rows, { onConflict: "book_id,source,signal_date" });
}
