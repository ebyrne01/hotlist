import { createClient } from "@/lib/supabase/client";
import type { UserRating } from "@/lib/types";

/**
 * Fetch a user's rating for a specific book.
 */
export async function getUserRating(
  userId: string,
  bookId: string
): Promise<UserRating | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("user_ratings")
    .select("star_rating, spice_rating, note")
    .eq("user_id", userId)
    .eq("book_id", bookId)
    .single();

  if (!data) return null;
  return {
    starRating: data.star_rating ?? null,
    spiceRating: data.spice_rating ?? null,
    note: data.note ?? null,
  };
}

/**
 * Save (upsert) a user's rating for a book.
 * Only updates the fields that are provided — does not overwrite existing values
 * for fields not included in the update.
 */
export async function saveUserRating(
  userId: string,
  bookId: string,
  rating: { starRating?: number; spiceRating?: number; note?: string }
): Promise<UserRating> {
  const supabase = createClient();

  // Build update payload — only include provided fields
  const payload: Record<string, unknown> = {
    user_id: userId,
    book_id: bookId,
    updated_at: new Date().toISOString(),
  };
  if (rating.starRating !== undefined) payload.star_rating = rating.starRating;
  if (rating.spiceRating !== undefined) payload.spice_rating = rating.spiceRating;
  if (rating.note !== undefined) payload.note = rating.note;

  const { data } = await supabase
    .from("user_ratings")
    .upsert(payload, { onConflict: "user_id,book_id" })
    .select("star_rating, spice_rating, note")
    .single();

  // If spice rating was updated, recalculate community average
  if (rating.spiceRating !== undefined) {
    await recalculateCommunitySpice(bookId);
  }

  return {
    starRating: data?.star_rating ?? null,
    spiceRating: data?.spice_rating ?? null,
    note: data?.note ?? null,
  };
}

/**
 * Clear a user's rating entirely for a book.
 */
export async function clearUserRating(
  userId: string,
  bookId: string
): Promise<void> {
  const supabase = createClient();
  await supabase
    .from("user_ratings")
    .delete()
    .eq("user_id", userId)
    .eq("book_id", bookId);

  // Recalculate community spice after deletion
  await recalculateCommunitySpice(bookId);
}

/**
 * Get the community spice average for a book.
 * Returns null if fewer than 5 ratings (minimum for reliable average).
 */
export async function getCommunitySpiceAverage(
  bookId: string
): Promise<{ average: number; count: number } | null> {
  const supabase = createClient();
  const { data: allRatings } = await supabase
    .from("user_ratings")
    .select("spice_rating")
    .eq("book_id", bookId)
    .not("spice_rating", "is", null);

  if (!allRatings || allRatings.length < 5) return null;

  const total = allRatings.reduce((sum, r) => sum + (r.spice_rating ?? 0), 0);
  return {
    average: Math.round(total / allRatings.length),
    count: allRatings.length,
  };
}

/**
 * Recalculate and store the community spice average in book_spice.
 * Called after any spice rating change. This logic already exists in
 * SpiceSection.tsx — this function is the canonical reusable version.
 */
async function recalculateCommunitySpice(bookId: string): Promise<void> {
  const supabase = createClient();
  const { data: allRatings } = await supabase
    .from("user_ratings")
    .select("spice_rating")
    .eq("book_id", bookId)
    .not("spice_rating", "is", null);

  if (!allRatings || allRatings.length === 0) return;

  const total = allRatings.reduce((sum, r) => sum + (r.spice_rating ?? 0), 0);
  const avg = Math.round(total / allRatings.length);

  await supabase.from("book_spice").upsert(
    {
      book_id: bookId,
      source: "hotlist_community",
      spice_level: avg,
      rating_count: allRatings.length,
      scraped_at: new Date().toISOString(),
    },
    { onConflict: "book_id,source" }
  );
}
