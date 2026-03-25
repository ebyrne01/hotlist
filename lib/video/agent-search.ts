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
 *
 * When the original query returns 0 results (common with garbled Haiku
 * cover reads like "Blood Deadened" for "Blood So Deadly Divine"), we
 * generate smart query variations and try them across all tiers.
 */
export async function searchBooksForAgent(query: string): Promise<AgentSearchResult[]> {
  // Tier 1: Local DB — word-based ilike (50-100ms)
  const localResults = await searchLocalDb(query);
  if (localResults.length > 0) {
    return localResults.slice(0, 5);
  }

  // Tier 1b: Try title-only search — handles "Starside Alex Aster" where
  // the full query fails because no single field contains all words.
  const titleOnly = extractLikelyTitle(query);
  if (titleOnly && titleOnly !== query) {
    const titleResults = await searchLocalDb(titleOnly);
    if (titleResults.length > 0) {
      return titleResults.slice(0, 5);
    }
  }

  // Tier 1c: Fuzzy trigram search — catches misspellings in local DB
  // e.g. "Ayan Bray" → "Ayana Gray" if the book exists locally
  const fuzzyResults = await searchLocalDbFuzzy(query);
  if (fuzzyResults.length > 0) {
    return fuzzyResults.slice(0, 5);
  }

  // Tier 2: Google Books API (200-500ms)
  const googleResults = await searchGoogleBooksForAgent(query);
  if (googleResults.length > 0) {
    return googleResults.slice(0, 5);
  }

  // Tier 2b: Try query variations on Google Books
  // Garbled cover reads often have the right words in the wrong order,
  // or extra/missing words. Try smart permutations.
  const variations = generateQueryVariations(query);
  for (const variation of variations) {
    const varResults = await searchGoogleBooksForAgent(variation);
    if (varResults.length > 0) {
      return varResults.slice(0, 5);
    }
  }

  // Tier 3: Goodreads scraping (1.5s+ per call, last resort)
  const goodreadsResults = await searchGoodreadsForAgent(query);
  if (goodreadsResults.length > 0) {
    return goodreadsResults.slice(0, 5);
  }

  // Tier 3b: Try variations on Goodreads too
  for (const variation of variations.slice(0, 2)) {
    const varResults = await searchGoodreadsForAgent(variation);
    if (varResults.length > 0) {
      return varResults.slice(0, 5);
    }
  }

  return [];
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ _score, ...rest }) => rest);
}

/**
 * Tier 1c: Fuzzy trigram search via Supabase RPC.
 * Catches misspelled titles/authors that word-based ilike misses.
 * Uses pg_trgm with a low similarity threshold (0.15).
 */
async function searchLocalDbFuzzy(query: string): Promise<AgentSearchResult[]> {
  const supabase = getAdminClient();
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  try {
    const { data: rows } = await supabase.rpc("search_books_fuzzy", {
      search_query: trimmed,
      similarity_floor: 0.2,
      max_results: 10,
    });

    if (!rows || rows.length === 0) return [];

    // Fetch ratings for scoring
    const bookIds = rows.map((r: Record<string, unknown>) => r.id as string);
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

    return rows
      .filter((row: Record<string, unknown>) => !isJunkTitle(row.title as string))
      .map((row: Record<string, unknown>): AgentSearchResult => {
        const r = ratingMap.get(row.id as string);
        return {
          goodreads_id: (row.goodreads_id as string) ?? null,
          title: (row.title as string) ?? "",
          author: (row.author as string) ?? "",
          rating: r?.rating ?? null,
          rating_count: r?.count ?? null,
          series_name: (row.series_name as string) || null,
          series_position: (row.series_position as number) ?? null,
          source: "local_db",
        };
      });
  } catch {
    return [];
  }
}

/**
 * Generate smart query variations from a potentially garbled search query.
 *
 * Haiku cover reads often produce:
 *  - Partial titles: "Blood Deadened" → "Blood So Deadly Divine"
 *  - Misspelled authors: "J.M. Barvalet" → "J.M. Grosvalet"
 *  - Missing prefixes: "Medusa" → "I, Medusa"
 *
 * This generates variations ordered by likelihood of success:
 *  1. Author name alone (if extractable) — most reliable when title is garbled
 *  2. Title words only (drop author) — helps Google Books/Goodreads fuzzy match
 *  3. Longest word alone — distinctive words survive misreads better
 *  4. First + last word — captures partial title + author fragments
 */
function generateQueryVariations(query: string): string[] {
  const trimmed = query.trim();
  const words = trimmed.split(/\s+/).filter((w) => w.length > 1);
  if (words.length <= 1) return [];

  const variations: string[] = [];
  const seen = new Set<string>();
  const addVariation = (v: string) => {
    const normalized = v.trim().toLowerCase();
    if (normalized && normalized !== trimmed.toLowerCase() && !seen.has(normalized)) {
      seen.add(normalized);
      variations.push(v.trim());
    }
  };

  // Split into likely title and author parts
  const { title: likelyTitle, author: likelyAuthor } = splitTitleAuthor(trimmed);

  // Variation 1: Author name alone — most useful when title is badly garbled
  if (likelyAuthor && likelyAuthor.split(/\s+/).length >= 2) {
    addVariation(likelyAuthor);
  }

  // Variation 2: Title words only
  if (likelyTitle && likelyTitle !== trimmed) {
    addVariation(likelyTitle);
  }

  // Variation 3: The longest word (most distinctive, survives garbling)
  const longestWord = words.reduce((a, b) => (a.length >= b.length ? a : b));
  if (longestWord.length >= 4) {
    addVariation(longestWord);
  }

  // Variation 4: Drop middle words — keep first and last
  if (words.length >= 4) {
    addVariation(`${words[0]} ${words[words.length - 1]}`);
  }

  // Variation 5: Each individual word >= 5 chars (distinctive words)
  for (const word of words) {
    if (word.length >= 5 && variations.length < 5) {
      addVariation(word);
    }
  }

  return variations.slice(0, 4); // Cap at 4 variations to limit API calls
}

/**
 * Heuristic split of "Title Author" into separate parts.
 * Handles patterns like:
 *   "Blood Deadened J.M. Barvalet" → { title: "Blood Deadened", author: "J.M. Barvalet" }
 *   "Medusa Ayan Bray" → { title: "Medusa", author: "Ayan Bray" }
 *   "Fourth Wing Rebecca Yarros" → { title: "Fourth Wing", author: "Rebecca Yarros" }
 */
function splitTitleAuthor(query: string): { title: string; author: string | null } {
  const words = query.trim().split(/\s+/);

  // Look for author indicators: initials (J.M., H.D.), "by" keyword
  const byIdx = words.findIndex((w) => w.toLowerCase() === "by");
  if (byIdx > 0) {
    return {
      title: words.slice(0, byIdx).join(" "),
      author: words.slice(byIdx + 1).join(" ") || null,
    };
  }

  // Look for initials pattern (e.g., "J.M." or "H.D.") — strong author signal
  const initialIdx = words.findIndex((w) => /^[A-Z]\.\w?\.?$/.test(w));
  if (initialIdx > 0) {
    return {
      title: words.slice(0, initialIdx).join(" "),
      author: words.slice(initialIdx).join(" ") || null,
    };
  }

  // Default: assume last 2 words are author name (first + last),
  // or last 1 word if query is only 2 words
  if (words.length >= 4) {
    return {
      title: words.slice(0, -2).join(" "),
      author: words.slice(-2).join(" "),
    };
  }
  if (words.length === 3) {
    // Could be "Title FirstName LastName" or "Word Word Word"
    // Try both splits
    return {
      title: words.slice(0, 1).join(" "),
      author: words.slice(1).join(" "),
    };
  }
  if (words.length === 2) {
    return {
      title: words[0],
      author: words[1],
    };
  }

  return { title: query.trim(), author: null };
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

/**
 * Extract the likely book title from an agent search query.
 * Queries often look like "Starside Alex Aster" or "Heart of Mischief Emma Noyes".
 * Uses splitTitleAuthor for smarter extraction.
 */
function extractLikelyTitle(query: string): string | null {
  const trimmed = query.trim();
  if (trimmed.split(/\s+/).length <= 1) return null;

  // If query contains a quoted title, extract it
  const quotedMatch = trimmed.match(/^"([^"]+)"/);
  if (quotedMatch) return quotedMatch[1];

  const { title } = splitTitleAuthor(trimmed);
  return title !== trimmed ? title : null;
}
