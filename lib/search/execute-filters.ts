/**
 * Structured filter execution — turns parsed SearchFilters into Supabase queries.
 *
 * Uses progressive relaxation: if strict AND across all filters yields < 5 results,
 * progressively drops lower-priority filters until we have enough books.
 *
 * Filter priority (dropped last → first):
 *   1. Tropes (core intent — kept longest)
 *   2. Spice range
 *   3. Similar-to
 *   4. Rating minimum
 *
 * Subgenre is IGNORED as a hard filter (column is unpopulated) — used only for sort boost.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { hydrateBookDetailBatch } from "@/lib/books/cache";
import { getTopBuzzBooks } from "@/lib/books/buzz-score";
import { isJunkTitle } from "@/lib/books/romance-filter";
import { deduplicateBooks } from "@/lib/books/utils";
import { findBook } from "@/lib/books";
import type { SearchFilters } from "./parse-intent";
import type { BookDetail } from "@/lib/types";

const MAX_RESULTS = 30;
const MAX_CANDIDATES = 200;
const MIN_RESULTS = 5;

// ── Filter set collection (parallel) ─────────────────

interface FilterSet {
  name: string;
  ids: Set<string>;
  /** Trope match counts per book (for relevance sorting) */
  tropeCounts?: Map<string, number>;
}

/** Get book IDs matching requested tropes. Returns ALL-match set if large enough, else ANY-match. */
async function getTropeFilterSet(
  supabase: ReturnType<typeof getAdminClient>,
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

/** Get book IDs within the requested spice range */
async function getSpiceFilterSet(
  supabase: ReturnType<typeof getAdminClient>,
  spiceMin: number | null,
  spiceMax: number | null
): Promise<FilterSet | null> {
  if (spiceMin === null && spiceMax === null) return null;

  let query = supabase
    .from("spice_signals")
    .select("book_id, spice_value")
    .in("source", ["community", "romance_io", "llm_inference"]);

  if (spiceMin !== null) query = query.gte("spice_value", spiceMin);
  if (spiceMax !== null) query = query.lte("spice_value", spiceMax);

  const { data } = await query;
  if (!data || data.length === 0) return null;

  return {
    name: "spice",
    ids: new Set(data.map((s: { book_id: string }) => s.book_id)),
  };
}

/** Get book IDs meeting the rating minimum */
async function getRatingFilterSet(
  supabase: ReturnType<typeof getAdminClient>,
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

/** Get book IDs similar to a reference book (sharing >= 2 tropes) */
async function getSimilarFilterSet(
  supabase: ReturnType<typeof getAdminClient>,
  similarTo: string
): Promise<FilterSet | null> {
  const refResults = await findBook(similarTo);
  const refBook = refResults[0];
  if (!refBook) return null;

  const { data: refTropes } = await supabase
    .from("book_tropes")
    .select("trope_id")
    .eq("book_id", refBook.id);

  if (!refTropes || refTropes.length === 0) return null;

  const refTropeIds = refTropes.map((t: { trope_id: string }) => t.trope_id);
  const { data: similarBts } = await supabase
    .from("book_tropes")
    .select("book_id, trope_id")
    .in("trope_id", refTropeIds)
    .neq("book_id", refBook.id);

  if (!similarBts || similarBts.length === 0) return null;

  const simCounts = new Map<string, number>();
  for (const bt of similarBts) {
    simCounts.set(bt.book_id, (simCounts.get(bt.book_id) ?? 0) + 1);
  }

  const minOverlap = Math.min(2, refTropeIds.length);
  const ids = new Set<string>();
  simCounts.forEach((count, id) => {
    if (count >= minOverlap) ids.add(id);
  });

  return ids.size > 0 ? { name: "similar", ids } : null;
}

// ── Main search function ─────────────────────────────

export async function executeFilteredSearch(
  filters: SearchFilters
): Promise<BookDetail[]> {
  const supabase = getAdminClient();

  // ── Collect filter sets in parallel ─────────────
  const [tropeSet, spiceSet, ratingSet, similarSet, buzzData] =
    await Promise.all([
      getTropeFilterSet(supabase, filters.tropes),
      getSpiceFilterSet(supabase, filters.spiceMin, filters.spiceMax),
      filters.ratingMin !== null
        ? getRatingFilterSet(supabase, filters.ratingMin)
        : null,
      filters.similarTo
        ? getSimilarFilterSet(supabase, filters.similarTo)
        : null,
      filters.trending ? getTopBuzzBooks(100) : null,
    ]);

  // Build buzz scoring data
  let buzzScores: Map<string, number> | null = null;
  if (buzzData) {
    buzzScores = new Map(buzzData.map((b) => [b.bookId, b.score]));
  }

  // ── Progressive intersection ────────────────────
  // Priority order: tropes (1) > spice (2) > similar (3) > rating (4)
  // We keep high-priority filters and drop low-priority ones when results are too few.
  const filterSets: FilterSet[] = [];
  if (tropeSet) filterSets.push(tropeSet);
  if (spiceSet) filterSets.push(spiceSet);
  if (similarSet) filterSets.push(similarSet);
  if (ratingSet) filterSets.push(ratingSet);

  // Try full intersection, then progressively drop from the end (lowest priority)
  let bookIds: Set<string> | null = null;

  for (let tryCount = filterSets.length; tryCount >= 1; tryCount--) {
    const subset = filterSets.slice(0, tryCount);
    let ids: Set<string> | null = null;
    for (const fs of subset) {
      ids = intersect(ids, fs.ids);
    }
    if (ids && ids.size >= MIN_RESULTS) {
      bookIds = ids;
      break;
    }
    // If this is the last attempt (single filter), use whatever we have
    if (tryCount === 1 && ids && ids.size > 0) {
      bookIds = ids;
    }
  }

  // If no filter sets matched at all, use buzz or return broad results
  if (!bookIds && filterSets.length === 0) {
    if (buzzData) {
      bookIds = new Set(buzzData.map((b) => b.bookId));
    }
    // Otherwise bookIds stays null → broad query (limited by MAX_CANDIDATES)
  }

  // If filters existed but intersection is completely empty, try the largest single set
  if (bookIds === null && filterSets.length > 0) {
    // Use the largest individual filter set as fallback
    let largest: FilterSet | null = null;
    for (const fs of filterSets) {
      if (!largest || fs.ids.size > largest.ids.size) largest = fs;
    }
    if (largest) bookIds = largest.ids;
  }

  // ── Early exit if truly nothing ─────────────────
  if (bookIds && bookIds.size === 0) {
    return [];
  }

  // ── Fetch candidate books ──────────────────────
  // Note: subgenre is NOT used as a hard filter (column unpopulated).
  // It's used as a sort boost in relevance ranking instead.
  let query = supabase
    .from("books")
    .select("*")
    .eq("is_canon", true)
    .eq("enrichment_status", "complete")
    .not("cover_url", "is", null);

  if (bookIds) {
    const idArray = Array.from(bookIds).slice(0, MAX_CANDIDATES);
    query = query.in("id", idArray);
  }

  if (filters.sortBy === "newest") {
    query = query.order("published_year", {
      ascending: false,
      nullsFirst: false,
    });
  } else {
    query = query.order("updated_at", { ascending: false });
  }

  const { data: books } = await query.limit(MAX_CANDIDATES);
  if (!books || books.length === 0) return [];

  // Filter junk titles
  const cleanBooks = books.filter(
    (b: Record<string, unknown>) =>
      !isJunkTitle(b.title as string, b.author as string)
  );

  // ── Batch hydrate ──────────────────────────────
  const hydratedMap = await hydrateBookDetailBatch(
    supabase,
    cleanBooks as Record<string, unknown>[]
  );

  let results: BookDetail[] = [];
  for (const book of cleanBooks) {
    const hydrated = hydratedMap.get(book.id as string);
    if (hydrated) results.push(hydrated);
  }

  // ── Post-hydration filters ─────────────────────
  if (filters.standalone) {
    results = results.filter((b) => !b.seriesName);
  }

  // ── Sort ───────────────────────────────────────
  // Pass tropeCounts from the trope filter for relevance scoring
  const tropeCounts = tropeSet?.tropeCounts ?? null;
  results = sortResults(results, filters, buzzScores, tropeCounts);

  return deduplicateBooks(results).slice(0, MAX_RESULTS);
}

/** Intersect a running set with a new set (or initialize if null) */
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

/** Sort results based on the parsed sort preference */
function sortResults(
  results: BookDetail[],
  filters: SearchFilters,
  buzzScores: Map<string, number> | null,
  tropeCounts: Map<string, number> | null
): BookDetail[] {
  const sorted = [...results];

  switch (filters.sortBy) {
    case "rating":
      sorted.sort((a, b) => {
        const aR =
          a.ratings.find((r) => r.source === "goodreads")?.rating ?? 0;
        const bR =
          b.ratings.find((r) => r.source === "goodreads")?.rating ?? 0;
        return bR - aR;
      });
      break;

    case "spice":
      sorted.sort(
        (a, b) =>
          (b.compositeSpice?.score ?? 0) - (a.compositeSpice?.score ?? 0)
      );
      break;

    case "buzz":
      if (buzzScores) {
        sorted.sort(
          (a, b) =>
            (buzzScores.get(b.id) ?? 0) - (buzzScores.get(a.id) ?? 0)
        );
      }
      break;

    case "newest":
      sorted.sort(
        (a, b) => (b.publishedYear ?? 0) - (a.publishedYear ?? 0)
      );
      break;

    default:
      // Relevance: prioritize trope match count, then rating
      sorted.sort((a, b) => {
        // Use pre-computed trope counts if available (more accurate than post-hydration)
        if (tropeCounts) {
          const aHits = tropeCounts.get(a.id) ?? 0;
          const bHits = tropeCounts.get(b.id) ?? 0;
          if (bHits !== aHits) return bHits - aHits;
        } else if (filters.tropes.length > 0) {
          const requestedSlugs = new Set(filters.tropes);
          const aTropeHits = a.tropes.filter((t) =>
            requestedSlugs.has(t.slug)
          ).length;
          const bTropeHits = b.tropes.filter((t) =>
            requestedSlugs.has(t.slug)
          ).length;
          if (bTropeHits !== aTropeHits) return bTropeHits - aTropeHits;
        }

        // Tiebreak by Goodreads rating
        const aR =
          a.ratings.find((r) => r.source === "goodreads")?.rating ?? 0;
        const bR =
          b.ratings.find((r) => r.source === "goodreads")?.rating ?? 0;
        return bR - aR;
      });
      break;
  }

  return sorted;
}
