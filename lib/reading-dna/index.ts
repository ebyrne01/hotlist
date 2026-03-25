/**
 * READING DNA — Database Operations
 *
 * Handles saving, loading, and recomputing DNA profiles.
 * All mutations use the admin client (service role).
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { buildDnaProfile, type DnaSignal, SIGNAL_WEIGHTS } from "./compute";
import type { DnaProfile } from "./compute";

// ── Types ────────────────────────────────────────────

export interface ReadingDnaRow {
  id: string;
  userId: string;
  tropeAffinities: Record<string, number>;
  spicePreferred: number;
  spiceTolerance: number;
  source: "quiz" | "import" | "scan" | "organic";
  signalCount: number;
  lastComputedAt: string;
  dnaDescription: string | null;
}

// ── Read ─────────────────────────────────────────────

/**
 * Get a user's Reading DNA profile. Returns null if they haven't completed onboarding.
 */
export async function getDna(userId: string): Promise<ReadingDnaRow | null> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("reading_dna")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!data) return null;

  return {
    id: data.id,
    userId: data.user_id,
    tropeAffinities: data.trope_affinities as Record<string, number>,
    spicePreferred: parseFloat(data.spice_preferred),
    spiceTolerance: parseFloat(data.spice_tolerance),
    source: data.source,
    signalCount: data.signal_count,
    lastComputedAt: data.last_computed_at,
    dnaDescription: (data.dna_description as string) ?? null,
  };
}

// ── Write ────────────────────────────────────────────

/**
 * Save or update a user's Reading DNA profile.
 */
export async function saveDna(
  userId: string,
  profile: DnaProfile,
  source: "quiz" | "import" | "scan" | "organic"
): Promise<void> {
  const supabase = getAdminClient();

  await supabase.from("reading_dna").upsert(
    {
      user_id: userId,
      trope_affinities: profile.tropeAffinities,
      spice_preferred: profile.spicePreferred,
      spice_tolerance: profile.spiceTolerance,
      source,
      signal_count: profile.signalCount,
      last_computed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
}

/**
 * Save a batch of DNA signals (quiz picks, imports, scans, etc.).
 * Uses upsert to handle re-imports gracefully.
 */
export async function saveSignals(
  userId: string,
  signals: { bookId: string; signalType: string; weight: number }[]
): Promise<void> {
  const supabase = getAdminClient();

  const rows = signals.map((s) => ({
    user_id: userId,
    book_id: s.bookId,
    signal_type: s.signalType,
    weight: s.weight,
  }));

  // Batch upsert in chunks of 100
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await supabase
      .from("reading_dna_signals")
      .upsert(chunk, { onConflict: "user_id,book_id,signal_type" });
  }
}

// ── Recompute ────────────────────────────────────────

/**
 * Full DNA recomputation from all signals.
 * Called after: quiz, import, scan, rating change, reading status change.
 */
export async function recomputeDna(userId: string): Promise<DnaProfile | null> {
  const supabase = getAdminClient();

  // 1. Fetch all signals for this user
  const { data: signalRows } = await supabase
    .from("reading_dna_signals")
    .select("book_id, signal_type, weight")
    .eq("user_id", userId);

  if (!signalRows || signalRows.length === 0) return null;

  // 2. Get trope vectors for all signal books
  const bookIds = Array.from(new Set(signalRows.map((s) => s.book_id as string)));
  const { data: vectorRows } = await supabase
    .from("book_trope_vectors")
    .select("book_id, vector")
    .in("book_id", bookIds);

  const vectorMap = new Map<string, Record<string, number>>();
  for (const row of vectorRows ?? []) {
    vectorMap.set(row.book_id, row.vector as Record<string, number>);
  }

  // 3. Build DnaSignal array
  const dnaSignals: DnaSignal[] = [];
  for (const row of signalRows) {
    const tropes = vectorMap.get(row.book_id as string);
    if (!tropes) continue; // book has no trope vector yet
    dnaSignals.push({
      bookId: row.book_id as string,
      weight: parseFloat(row.weight),
      tropes: Object.keys(tropes),
    });
  }

  if (dnaSignals.length === 0) return null;

  // 4. Get quiz spice (from existing DNA if any)
  const existingDna = await getDna(userId);
  const quizSpice = existingDna?.spicePreferred ?? null;

  // 5. Get spice levels for rated books
  const { data: userRatings } = await supabase
    .from("user_ratings")
    .select("book_id, spice_rating")
    .eq("user_id", userId)
    .not("spice_rating", "is", null);

  const ratedSpiceLevels = (userRatings ?? []).map((r) => ({
    level: r.spice_rating as number,
    weight: 1.0,
  }));

  // 6. Compute and save
  const profile = buildDnaProfile(dnaSignals, quizSpice, ratedSpiceLevels);
  const source = existingDna?.source ?? "organic";
  await saveDna(userId, profile, source);

  return profile;
}

/**
 * Get the weight for a star rating value.
 */
export function weightForStarRating(rating: number): number {
  if (rating >= 5) return SIGNAL_WEIGHTS.star_5;
  if (rating >= 4) return SIGNAL_WEIGHTS.star_4;
  if (rating >= 3) return SIGNAL_WEIGHTS.star_3;
  if (rating >= 2) return SIGNAL_WEIGHTS.star_2;
  return SIGNAL_WEIGHTS.star_1;
}

// Re-export types and computation functions
export type { DnaProfile, DnaSignal } from "./compute";
export { computeTropeAffinities, computeSpicePreference, SIGNAL_WEIGHTS } from "./compute";
export { scoreBook, rankBooks, type BookVector, type ScoredBook } from "./score";
