/**
 * SHARED FILTER UTILITIES
 *
 * Composable filter sets extracted from lib/search/execute-filters.ts.
 * Each function returns a FilterSet (a named set of book IDs that passed
 * that filter). Consumers compose these sets via intersectFilterSets().
 *
 * Key difference from the original: every function accepts a Supabase client
 * as its first parameter instead of calling getAdminClient() internally.
 * This ensures the caller creates one client and passes it through.
 */

import { getTopBuzzBooks, type BuzzScoreResult } from "@/lib/books/buzz-score";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = any;

export interface FilterSet {
  name: string;
  ids: Set<string>;
  /** Trope match counts per book (for relevance sorting) */
  tropeCounts?: Map<string, number>;
  /** Buzz scores per book (for buzz sorting) */
  buzzScores?: Map<string, number>;
}

const MIN_RESULTS = 5;

// ── Trope filter ─────────────────────────────────────

/**
 * Get book IDs matching requested tropes.
 * Returns ALL-match set if it has >= MIN_RESULTS, else falls back to ANY-match.
 * Also returns tropeCounts map (book_id → number of matching tropes) for ranking.
 */
export async function getTropeFilterSet(
  supabase: SupabaseAdmin,
  tropeSlugs: string[]
): Promise<FilterSet | null> {
  if (tropeSlugs.length === 0) return null;

  const { data: tropeRows } = await supabase
    .from("tropes")
    .select("id, slug")
    .in("slug", tropeSlugs);

  if (!tropeRows || tropeRows.length === 0) return null;

  const tropeIds = tropeRows.map((t: { id: string }) => t.id);
  const { data: bookTropes } = await supabase
    .from("book_tropes")
    .select("book_id, trope_id")
    .in("trope_id", tropeIds);

  if (!bookTropes || bookTropes.length === 0) return null;

  const counts = new Map<string, number>();
  for (const bt of bookTropes) {
    counts.set(bt.book_id, (counts.get(bt.book_id) ?? 0) + 1);
  }

  // ALL-match first; fall back to ANY-match
  const allMatch = new Set<string>();
  const anyMatch = new Set<string>();
  counts.forEach((count, id) => {
    anyMatch.add(id);
    if (count >= tropeIds.length) allMatch.add(id);
  });

  return {
    name: "tropes",
    ids: allMatch.size >= MIN_RESULTS ? allMatch : anyMatch,
    tropeCounts: counts,
  };
}

// ── Exclude trope filter ─────────────────────────────

/**
 * Get book IDs that have ANY of the specified tropes (for exclusion).
 * Returns a set of IDs to subtract from results.
 */
export async function getExcludeTropeSet(
  supabase: SupabaseAdmin,
  tropeSlugs: string[]
): Promise<Set<string>> {
  if (tropeSlugs.length === 0) return new Set();

  const { data: tropeRows } = await supabase
    .from("tropes")
    .select("id")
    .in("slug", tropeSlugs);

  if (!tropeRows || tropeRows.length === 0) return new Set();

  const tropeIds = tropeRows.map((t: { id: string }) => t.id);
  const { data: bookTropes } = await supabase
    .from("book_tropes")
    .select("book_id")
    .in("trope_id", tropeIds);

  return new Set((bookTropes ?? []).map((bt: { book_id: string }) => bt.book_id));
}

// ── Spice filter ─────────────────────────────────────

/**
 * Get book IDs within the requested spice range.
 * Queries spice_signals for community, romance_io, and llm_inference sources.
 */
export async function getSpiceFilterSet(
  supabase: SupabaseAdmin,
  spiceMin: number | null | undefined,
  spiceMax: number | null | undefined
): Promise<FilterSet | null> {
  if (spiceMin == null && spiceMax == null) return null;

  let query = supabase
    .from("spice_signals")
    .select("book_id, spice_value")
    .in("source", ["community", "romance_io", "llm_inference"]);

  if (spiceMin != null) query = query.gte("spice_value", spiceMin);
  if (spiceMax != null) query = query.lte("spice_value", spiceMax);

  const { data } = await query;
  if (!data || data.length === 0) return null;

  return {
    name: "spice",
    ids: new Set(data.map((s: { book_id: string }) => s.book_id)),
  };
}

// ── Rating filter ────────────────────────────────────

/**
 * Get book IDs meeting the Goodreads rating minimum.
 */
export async function getRatingFilterSet(
  supabase: SupabaseAdmin,
  ratingMin: number
): Promise<FilterSet | null> {
  const { data } = await supabase
    .from("book_ratings")
    .select("book_id")
    .eq("source", "goodreads")
    .gte("rating", ratingMin);

  if (!data || data.length === 0) return null;

  return {
    name: "rating",
    ids: new Set(data.map((r: { book_id: string }) => r.book_id)),
  };
}

// ── Similarity filter ────────────────────────────────

/**
 * Get book IDs similar to a reference book.
 *
 * Two sources:
 * 1. Trope overlap: books sharing >= 2 tropes with the reference
 * 2. Cached AI recommendations from the book_recommendations table
 *
 * Returns { filterSet, recommendedIds } — recommendedIds is separate
 * so callers can use it for downstream boost logic if needed.
 */
export async function getSimilarFilterSet(
  supabase: SupabaseAdmin,
  bookId: string
): Promise<{ filterSet: FilterSet | null; recommendedIds: Set<string> }> {
  // Source 1: trope overlap
  const { data: refTropes } = await supabase
    .from("book_tropes")
    .select("trope_id")
    .eq("book_id", bookId);

  const tropeOverlapIds = new Set<string>();
  if (refTropes && refTropes.length > 0) {
    const refTropeIds = refTropes.map((t: { trope_id: string }) => t.trope_id);
    const { data: similarBts } = await supabase
      .from("book_tropes")
      .select("book_id, trope_id")
      .in("trope_id", refTropeIds)
      .neq("book_id", bookId);

    if (similarBts) {
      const simCounts = new Map<string, number>();
      for (const bt of similarBts) {
        simCounts.set(bt.book_id, (simCounts.get(bt.book_id) ?? 0) + 1);
      }
      const minOverlap = Math.min(2, refTropeIds.length);
      simCounts.forEach((count, id) => {
        if (count >= minOverlap) tropeOverlapIds.add(id);
      });
    }
  }

  // Source 2: cached AI recommendations
  const { data: cachedRecs } = await supabase
    .from("book_recommendations")
    .select("recommended_book_id")
    .eq("book_id", bookId);

  const recommendedIds = new Set<string>(
    (cachedRecs ?? []).map((r: { recommended_book_id: string }) => r.recommended_book_id)
  );

  // Merge both sets
  const allIds = new Set<string>();
  tropeOverlapIds.forEach((id) => allIds.add(id));
  recommendedIds.forEach((id) => allIds.add(id));

  const filterSet =
    allIds.size > 0 ? { name: "similar", ids: allIds } : null;

  return { filterSet, recommendedIds };
}

// ── Buzz filter ──────────────────────────────────────

/**
 * Get top buzz-scored book IDs.
 * Wraps the existing getTopBuzzBooks() and returns a FilterSet
 * with buzz scores stored in the buzzScores map.
 */
export async function getBuzzFilterSet(
  limit: number = 100
): Promise<{ filterSet: FilterSet | null; buzzData: BuzzScoreResult[] }> {
  const buzzData = await getTopBuzzBooks(limit);
  if (buzzData.length === 0) return { filterSet: null, buzzData: [] };

  const buzzScores = new Map<string, number>();
  const ids = new Set<string>();
  for (const b of buzzData) {
    ids.add(b.bookId);
    buzzScores.set(b.bookId, b.score);
  }

  return {
    filterSet: { name: "buzz", ids, buzzScores },
    buzzData,
  };
}

// ── Progressive intersection ─────────────────────────

/**
 * Intersect a running set with a new set (or initialize if null).
 */
function intersect(
  existing: Set<string> | null,
  incoming: Set<string>
): Set<string> {
  if (!existing) return incoming;
  const result = new Set<string>();
  existing.forEach((id) => {
    if (incoming.has(id)) result.add(id);
  });
  return result;
}

/**
 * Progressive intersection: try all filters, then drop from the end
 * (lowest priority) until we have enough results.
 *
 * Filter priority order is determined by the order of the input array.
 * Callers control priority by ordering their sets accordingly.
 *
 * If full intersection yields < minResults, progressively drops the
 * last filter set (lowest priority) until we have enough or only one
 * filter remains. If all intersections are too small, falls back to
 * the largest individual filter set.
 */
export function intersectFilterSets(
  sets: FilterSet[],
  minResults: number = MIN_RESULTS
): { ids: Set<string> | null; applied: string[]; relaxed: string[] } {
  if (sets.length === 0) {
    return { ids: null, applied: [], relaxed: [] };
  }

  // Try full intersection, then progressively drop from the end
  for (let tryCount = sets.length; tryCount >= 1; tryCount--) {
    const subset = sets.slice(0, tryCount);
    let ids: Set<string> | null = null;
    for (const fs of subset) {
      ids = intersect(ids, fs.ids);
    }
    if (ids && ids.size >= minResults) {
      return {
        ids,
        applied: subset.map((s) => s.name),
        relaxed: sets.slice(tryCount).map((s) => s.name),
      };
    }
    // If this is the last attempt (single filter), use whatever we have
    if (tryCount === 1 && ids && ids.size > 0) {
      return {
        ids,
        applied: [subset[0].name],
        relaxed: sets.slice(1).map((s) => s.name),
      };
    }
  }

  // All intersections empty — fall back to the largest individual set
  let largest: FilterSet | null = null;
  for (const fs of sets) {
    if (!largest || fs.ids.size > largest.ids.size) largest = fs;
  }

  if (largest) {
    return {
      ids: largest.ids,
      applied: [largest.name],
      relaxed: sets.filter((s) => s !== largest).map((s) => s.name),
    };
  }

  return { ids: null, applied: [], relaxed: sets.map((s) => s.name) };
}
