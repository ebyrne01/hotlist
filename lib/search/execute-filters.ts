/**
 * Structured filter execution — turns parsed SearchFilters into Supabase queries.
 *
 * Uses the same patterns as findBook() and homepage rows:
 * - getAdminClient() for reading public book data
 * - hydrateBookDetailBatch() for efficient batch hydration (4 queries total)
 * - deduplicateBooks() for safety-net dedup
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

export async function executeFilteredSearch(
  filters: SearchFilters
): Promise<BookDetail[]> {
  const supabase = getAdminClient();

  // Accumulate book ID sets — each filter narrows the result
  let bookIds: Set<string> | null = null;

  // ── Trope filtering ────────────────────────────────
  if (filters.tropes.length > 0) {
    const { data: tropeRows } = await supabase
      .from("tropes")
      .select("id, slug")
      .in("slug", filters.tropes);

    if (tropeRows && tropeRows.length > 0) {
      const tropeIds = tropeRows.map((t: { id: string }) => t.id);

      const { data: bookTropes } = await supabase
        .from("book_tropes")
        .select("book_id, trope_id")
        .in("trope_id", tropeIds);

      if (bookTropes) {
        // Count tropes per book — prefer books matching ALL requested tropes
        const counts = new Map<string, number>();
        for (const bt of bookTropes) {
          counts.set(bt.book_id, (counts.get(bt.book_id) ?? 0) + 1);
        }

        // Try ALL-match first; fall back to ANY-match if no results
        const allMatch = new Set<string>();
        const anyMatch = new Set<string>();
        counts.forEach((count, id) => {
          anyMatch.add(id);
          if (count >= tropeIds.length) allMatch.add(id);
        });

        bookIds = allMatch.size > 0 ? allMatch : anyMatch;
      }
    }
  }

  // ── Spice filtering ────────────────────────────────
  // Filter on spice_signals directly (community + romance_io are most reliable)
  if (filters.spiceMin !== null || filters.spiceMax !== null) {
    let spiceQuery = supabase
      .from("spice_signals")
      .select("book_id, spice_value")
      .in("source", ["community", "romance_io", "llm_inference"]);

    if (filters.spiceMin !== null) {
      spiceQuery = spiceQuery.gte("spice_value", filters.spiceMin);
    }
    if (filters.spiceMax !== null) {
      spiceQuery = spiceQuery.lte("spice_value", filters.spiceMax);
    }

    const { data: spiceRows } = await spiceQuery;
    if (spiceRows) {
      const spiceBookIds = new Set(
        spiceRows.map((s: { book_id: string }) => s.book_id)
      );
      bookIds = intersect(bookIds, spiceBookIds);
    }
  }

  // ── Rating filtering ───────────────────────────────
  if (filters.ratingMin !== null) {
    const { data: ratingRows } = await supabase
      .from("book_ratings")
      .select("book_id")
      .eq("source", "goodreads")
      .gte("rating", filters.ratingMin);

    if (ratingRows) {
      const ratedBookIds = new Set(
        ratingRows.map((r: { book_id: string }) => r.book_id)
      );
      bookIds = intersect(bookIds, ratedBookIds);
    }
  }

  // ── "Similar to" handling ──────────────────────────
  if (filters.similarTo) {
    // Use findBook for fuzzy title matching (FTS + trigram)
    const refResults = await findBook(filters.similarTo);
    const refBook = refResults[0];

    if (refBook) {
      // Get tropes of the reference book
      const { data: refTropes } = await supabase
        .from("book_tropes")
        .select("trope_id")
        .eq("book_id", refBook.id);

      if (refTropes && refTropes.length > 0) {
        const refTropeIds = refTropes.map(
          (t: { trope_id: string }) => t.trope_id
        );

        // Find books sharing at least 2 tropes with the reference
        const { data: similarBts } = await supabase
          .from("book_tropes")
          .select("book_id, trope_id")
          .in("trope_id", refTropeIds)
          .neq("book_id", refBook.id);

        if (similarBts) {
          const simCounts = new Map<string, number>();
          for (const bt of similarBts) {
            simCounts.set(bt.book_id, (simCounts.get(bt.book_id) ?? 0) + 1);
          }
          const similarIds = new Set<string>();
          simCounts.forEach((count, id) => {
            if (count >= Math.min(2, refTropeIds.length)) similarIds.add(id);
          });

          bookIds = intersect(bookIds, similarIds);
        }
      }
    }
  }

  // ── Trending boost ─────────────────────────────────
  let buzzScores: Map<string, number> | null = null;
  if (filters.trending) {
    const buzzBooks = await getTopBuzzBooks(100);
    buzzScores = new Map(buzzBooks.map((b) => [b.bookId, b.score]));
    const buzzIds = new Set(buzzBooks.map((b) => b.bookId));

    if (!bookIds) {
      // No other filters — use buzz as the primary set
      bookIds = buzzIds;
    }
    // When combined with other filters, keep all matching books
    // but use buzz score for ranking (handled in sort step)
  }

  // ── Early exit if filters eliminated everything ────
  if (bookIds && bookIds.size === 0) {
    return [];
  }

  // ── Fetch candidate books ──────────────────────────
  let query = supabase
    .from("books")
    .select("*")
    .eq("enrichment_status", "complete")
    .not("cover_url", "is", null);

  // Subgenre filter
  if (filters.subgenre) {
    query = query.eq("subgenre", filters.subgenre);
  }

  if (bookIds) {
    // Cap candidates for performance
    const idArray = Array.from(bookIds).slice(0, MAX_CANDIDATES);
    query = query.in("id", idArray);
  }

  // Sort at DB level when possible
  if (filters.sortBy === "newest") {
    query = query.order("published_year", { ascending: false, nullsFirst: false });
  } else {
    query = query.order("updated_at", { ascending: false });
  }

  const { data: books } = await query.limit(MAX_CANDIDATES);
  if (!books || books.length === 0) return [];

  // Filter junk titles
  const cleanBooks = books.filter(
    (b: Record<string, unknown>) => !isJunkTitle(b.title as string, b.author as string)
  );

  // ── Batch hydrate ──────────────────────────────────
  const hydratedMap = await hydrateBookDetailBatch(
    supabase,
    cleanBooks as Record<string, unknown>[]
  );

  // Convert map to array preserving order
  let results: BookDetail[] = [];
  for (const book of cleanBooks) {
    const hydrated = hydratedMap.get(book.id as string);
    if (hydrated) results.push(hydrated);
  }

  // ── Post-hydration filters ─────────────────────────
  if (filters.standalone) {
    results = results.filter((b) => !b.seriesName);
  }
  // seriesComplete would go here when we have that data

  // ── Sort ───────────────────────────────────────────
  results = sortResults(results, filters, buzzScores);

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
  buzzScores: Map<string, number> | null
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
          (a, b) => (buzzScores.get(b.id) ?? 0) - (buzzScores.get(a.id) ?? 0)
        );
      }
      break;

    case "newest":
      sorted.sort(
        (a, b) => (b.publishedYear ?? 0) - (a.publishedYear ?? 0)
      );
      break;

    default:
      // Relevance: prioritize books with more trope matches, then by rating
      sorted.sort((a, b) => {
        // Trope match count (more = better)
        const requestedSlugs = new Set(filters.tropes);
        const aTropeHits = a.tropes.filter((t) =>
          requestedSlugs.has(t.slug)
        ).length;
        const bTropeHits = b.tropes.filter((t) =>
          requestedSlugs.has(t.slug)
        ).length;
        if (bTropeHits !== aTropeHits) return bTropeHits - aTropeHits;

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
