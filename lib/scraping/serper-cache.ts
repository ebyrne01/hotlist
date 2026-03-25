/**
 * SERPER QUERY CACHE
 *
 * Caches Serper query results to avoid re-querying sources that
 * genuinely don't have data for a book. 30-day TTL.
 *
 * Key use case: romance.io returns "no data" for ~43% of books.
 * Without caching, the spice-gap-monitor re-queues these books
 * every month, burning Serper budget on known misses.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { createHash } from "crypto";

/** Hash a query string to a stable key */
function hashQuery(query: string): string {
  return createHash("sha256").update(query).digest("hex").slice(0, 32);
}

type ResultStatus = "hit" | "no_data" | "error";

/**
 * Check if a query result is cached and still fresh.
 * Returns the cached status if found and within TTL, null otherwise.
 */
export async function getCachedResult(
  query: string,
  ttlDays = 30
): Promise<ResultStatus | null> {
  const supabase = getAdminClient();
  const hash = hashQuery(query);

  const { data } = await supabase
    .from("serper_query_cache")
    .select("result_status, queried_at, miss_count")
    .eq("query_hash", hash)
    .single();

  if (!data) return null;

  // Check TTL
  const age = Date.now() - new Date(data.queried_at as string).getTime();
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  if (age > ttlMs) return null;

  return data.result_status as ResultStatus;
}

/**
 * Check if a query should be skipped entirely.
 * Returns true if the query has returned "no_data" 3+ times (persistent miss).
 */
export async function shouldSkipQuery(query: string): Promise<boolean> {
  const supabase = getAdminClient();
  const hash = hashQuery(query);

  const { data } = await supabase
    .from("serper_query_cache")
    .select("result_status, miss_count, queried_at")
    .eq("query_hash", hash)
    .single();

  if (!data) return false;

  // If this query has missed 3+ times, skip it entirely
  if (data.result_status === "no_data" && (data.miss_count as number) >= 3) {
    return true;
  }

  return false;
}

/**
 * Save a query result to the cache.
 * Increments miss_count on repeated "no_data" results.
 */
export async function cacheResult(
  query: string,
  status: ResultStatus
): Promise<void> {
  const supabase = getAdminClient();
  const hash = hashQuery(query);

  // Check if exists to increment miss_count
  const { data: existing } = await supabase
    .from("serper_query_cache")
    .select("miss_count")
    .eq("query_hash", hash)
    .single();

  const missCount = status === "no_data"
    ? ((existing?.miss_count as number) ?? 0) + 1
    : 0;

  await supabase.from("serper_query_cache").upsert(
    {
      query_hash: hash,
      query_text: query.slice(0, 500), // Store for debugging, truncated
      result_status: status,
      miss_count: missCount,
      queried_at: new Date().toISOString(),
    },
    { onConflict: "query_hash" }
  );
}
