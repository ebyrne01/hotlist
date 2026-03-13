/**
 * COMMUNITY SPICE AGGREGATION
 *
 * Rolls up individual user spice ratings into a single "community" signal
 * in the spice_signals table. Called after every user rating save and
 * by the database trigger as a fallback.
 *
 * Confidence formula: min(0.5 + (count * 0.05), 1.0)
 *   - 1 rating  → 0.55
 *   - 5 ratings → 0.75
 *   - 10 ratings → 1.0
 */

import { getAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CommunitySignal {
  bookId: string;
  spiceValue: number;
  confidence: number;
  ratingCount: number;
  distribution: number[];
}

/**
 * Aggregate all user spice ratings for a book into a community signal.
 * Returns the upserted signal, or null if no ratings exist.
 */
export async function aggregateCommunitySpice(
  bookId: string,
  supabase?: SupabaseClient
): Promise<CommunitySignal | null> {
  const db = supabase ?? getAdminClient();

  // Fetch all non-null spice ratings for this book
  const { data: ratings, error } = await db
    .from("user_ratings")
    .select("spice_rating")
    .eq("book_id", bookId)
    .not("spice_rating", "is", null);

  if (error) {
    console.error(
      `[community-aggregation] Error fetching ratings for ${bookId}:`,
      error.message
    );
    return null;
  }

  if (!ratings || ratings.length === 0) return null;

  const values = ratings.map((r) => r.spice_rating as number);
  const count = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / count;

  // Distribution: how many ratings at each level (index 0=unused, 1-5)
  const distribution = [0, 0, 0, 0, 0, 0]; // [0, count_1, count_2, count_3, count_4, count_5]
  for (const v of values) {
    if (v >= 1 && v <= 5) distribution[v]++;
  }

  // Confidence: starts at 0.55 with 1 rating, caps at 1.0 at 10 ratings
  const confidence = Math.min(0.5 + count * 0.05, 1.0);
  const roundedSpice = Math.round(mean * 10) / 10;

  // Upsert into spice_signals
  const { error: upsertError } = await db.from("spice_signals").upsert(
    {
      book_id: bookId,
      source: "community",
      spice_value: roundedSpice,
      confidence: Math.round(confidence * 100) / 100,
      evidence: {
        rating_count: count,
        mean: roundedSpice,
        distribution: distribution.slice(1), // [count_1, count_2, count_3, count_4, count_5]
        aggregated_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "book_id,source" }
  );

  if (upsertError) {
    console.error(
      `[community-aggregation] Upsert failed for ${bookId}:`,
      upsertError.message
    );
    return null;
  }

  // Also update legacy book_spice table for backward compatibility
  await db.from("book_spice").upsert(
    {
      book_id: bookId,
      source: "hotlist_community",
      spice_level: Math.round(mean),
      rating_count: count,
      scraped_at: new Date().toISOString(),
    },
    { onConflict: "book_id,source" }
  );

  console.log(
    `[community-aggregation] Book ${bookId}: spice=${roundedSpice}, confidence=${confidence.toFixed(2)}, count=${count}`
  );

  return {
    bookId,
    spiceValue: roundedSpice,
    confidence: Math.round(confidence * 100) / 100,
    ratingCount: count,
    distribution: distribution.slice(1),
  };
}

/**
 * Batch aggregate community spice for multiple books.
 * Used by cron jobs and backfill scripts.
 */
export async function aggregateCommunitySpiceBatch(
  bookIds: string[]
): Promise<{ processed: number; updated: number }> {
  let processed = 0;
  let updated = 0;

  for (const bookId of bookIds) {
    processed++;
    const result = await aggregateCommunitySpice(bookId);
    if (result) updated++;
  }

  return { processed, updated };
}
