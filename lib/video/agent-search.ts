/**
 * AGENT SEARCH — Fast book search for the BookTok agent.
 *
 * The agent's search_goodreads tool was the #1 bottleneck — each Goodreads
 * search scrapes HTML with a 1.5s rate-limit delay. For 7 trilogies (21 books),
 * that's easily 60+ seconds of tool execution per batch.
 *
 * This module replaces direct Goodreads scraping with a tiered search:
 *   Tier 1: Local Supabase DB (~50-100ms) — high hit rate for popular BookTok titles
 *   Tier 2: Google Books API (~200-500ms) — fast, no rate limits
 *   Tier 3: Goodreads scraping (~1.5s+) — last resort, only if tiers 1-2 return 0
 *
 * For repeat BookTok content (same ~500 popular romance/romantasy books),
 * the local DB should resolve most queries instantly.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { searchGoogleBooks } from "@/lib/books/google-books";
import { searchGoodreads, type GoodreadsSearchResult } from "@/lib/books/goodreads-search";
import { isJunkTitle } from "@/lib/books/romance-filter";

/** Simplified result format — what the agent needs to pick a candidate */
export interface AgentSearchResult {
  goodreads_id: string | null;
  title: string;
  author: string;
  rating: number | null;
  rating_count: number | null;
  series_name: string | null;
  series_position: number | null;
  /** Where this result came from — helps the agent decide whether to confirm_book */
  source: "local_db" | "google_books" | "goodreads";
}

/**
 * Search for books using the tiered strategy.
 * Returns up to 5 results, fastest source first.
 */
export async function searchBooksForAgent(query: string): Promise<AgentSearchResult[]> {
  // Tier 1: Local DB — FTS + ilike + fuzzy (50-100ms)
  const localResults = await searchLocalDb(query);
  if (localResults.length > 0) {
    return localResults.slice(0, 5);
  }

  // Tier 2: Google Books API (200-500ms)
  const googleResults = await searchGoogleBooksForAgent(query);
  if (googleResults.length > 0) {
    return googleResults.slice(0, 5);
  }

  // Tier 3: Goodreads scraping (1.5s+ per call, last resort)
  const goodreadsResults = await searchGoodreadsForAgent(query);
  return goodreadsResults.slice(0, 5);
}

/**
 * Tier 1: Search local Supabase books table.
 * Lightweight version of searchBooksInCache — no full hydration, just the fields
 * the agent needs for identification + series verification.
 */
async function searchLocalDb(query: string): Promise<AgentSearchResult[]> {
  const supabase = getAdminClient();
  const trimmed = query.trim();
  const words = trimmed.split(/\s+/).filter((w) => w.length > 1);

  if (words.length === 0) return [];

  // Run word-based ilike on title and author in parallel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let titleQuery = supabase.from("books").select("id, title, author, goodreads_id, series_name, series_position") as any;
  for (const word of words) {
    titleQuery = titleQuery.ilike("title", `%${word}%`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let authorQuery = supabase.from("books").select("id, title, author, goodreads_id, series_name, series_position") as any;
  for (const word of words) {
    authorQuery = authorQuery.ilike("author", `%${word}%`);
  }

  // Also search by series_name — critical for "Flame Cursed Fae", "Hades Trials", etc.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let seriesQuery = supabase.from("books").select("id, title, author, goodreads_id, series_name, series_position") as any;
  for (const word of words) {
    seriesQuery = seriesQuery.ilike("series_name", `%${word}%`);
  }

  const [titleRes, authorRes, seriesRes] = await Promise.all([
    titleQuery.limit(10),
    authorQuery.limit(10),
    seriesQuery.limit(15),
  ]);

  // Merge and deduplicate
  const seen = new Set<string>();
  const allRows: Record<string, unknown>[] = [];
  for (const row of [
    ...(seriesRes.data ?? []),  // Series matches first — most relevant for agent
    ...(titleRes.data ?? []),
    ...(authorRes.data ?? []),
  ]) {
    const id = row.id as string;
    if (!seen.has(id) && !isJunkTitle(row.title as string)) {
      seen.add(id);
      allRows.push(row);
    }
  }

  if (allRows.length === 0) return [];

  // Fetch ratings for these books (for ranking + agent info)
  const bookIds = allRows.map((b) => b.id as string);
  const { data: ratingRows } = await supabase
    .from("book_ratings")
    .select("book_id, rating, rating_count")
    .in("book_id", bookIds)
    .eq("source", "goodreads");

  const ratingMap = new Map<string, { rating: number | null; count: number | null }>();
  for (const row of ratingRows ?? []) {
    ratingMap.set(row.book_id as string, {
      rating: row.rating as number | null,
      count: row.rating_count as number | null,
    });
  }

  // Score and sort by relevance
  const lowerQuery = trimmed.toLowerCase();
  const queryWords = lowerQuery.split(/\s+/).filter((w) => w.length > 1);

  return allRows
    .map((row): AgentSearchResult & { _score: number } => {
      const title = (row.title as string) ?? "";
      const author = (row.author as string) ?? "";
      const seriesName = (row.series_name as string) ?? "";
      const lt = title.toLowerCase();
      const la = author.toLowerCase();
      const ls = seriesName.toLowerCase();

      // Score: series name match > exact title > partial title > author
      let score = 0;
      if (ls && queryWords.every((w) => ls.includes(w))) score = 100;
      else if (lt === lowerQuery) score = 95;
      else if (lt.includes(lowerQuery)) score = 85;
      else if (queryWords.every((w) => lt.includes(w))) score = 75;
      else if (queryWords.every((w) => la.includes(w))) score = 70;
      else score = queryWords.filter((w) => lt.includes(w) || la.includes(w)).length / queryWords.length * 50;

      // Popularity tiebreaker
      const r = ratingMap.get(row.id as string);
      score += Math.min((r?.count ?? 0) / 100000, 5); // Up to 5 bonus points

      return {
        goodreads_id: (row.goodreads_id as string) ?? null,
        title,
        author,
        rating: r?.rating ?? null,
        rating_count: r?.count ?? null,
        series_name: seriesName || null,
        series_position: (row.series_position as number) ?? null,
        source: "local_db",
        _score: score,
      };
    })
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...rest }) => rest);
}

/**
 * Tier 2: Google Books API search.
 * Fast (~200-500ms), no rate limits, but no Goodreads ID or series info.
 */
async function searchGoogleBooksForAgent(query: string): Promise<AgentSearchResult[]> {
  try {
    const results = await searchGoogleBooks(query);
    return results
      .filter((r) => !isJunkTitle(r.title))
      .slice(0, 5)
      .map((r) => ({
        goodreads_id: null, // Google Books doesn't have Goodreads IDs
        title: r.title,
        author: r.author,
        rating: null,
        rating_count: null,
        series_name: null,
        series_position: null,
        source: "google_books" as const,
      }));
  } catch {
    return [];
  }
}

/**
 * Tier 3: Goodreads HTML scraping (slow, last resort).
 * Only called when both local DB and Google Books return 0 results.
 */
async function searchGoodreadsForAgent(query: string): Promise<AgentSearchResult[]> {
  try {
    const results = await searchGoodreads(query);
    return results.slice(0, 5).map((r: GoodreadsSearchResult) => ({
      goodreads_id: r.goodreadsId,
      title: r.title,
      author: r.author,
      rating: r.rating,
      rating_count: r.ratingCount,
      series_name: null, // Goodreads search doesn't return series info
      series_position: null,
      source: "goodreads" as const,
    }));
  } catch {
    return [];
  }
}
