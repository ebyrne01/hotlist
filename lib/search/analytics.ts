/**
 * Search analytics — logs every NL search for prompt tuning and quality tracking.
 * Fire-and-forget: never blocks the search response.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import type { SearchFilters } from "./parse-intent";

export function logSearchAnalytics(params: {
  id: string;
  queryText: string;
  intentType: string;
  filters: SearchFilters | null;
  resultCount: number;
  latencyMs: number;
}) {
  // Fire-and-forget — don't await, don't block search
  const supabase = getAdminClient();
  supabase
    .from("search_analytics")
    .insert({
      id: params.id,
      query_text: params.queryText,
      intent_type: params.intentType,
      filters: params.filters,
      result_count: params.resultCount,
      latency_ms: params.latencyMs,
    })
    .then(({ error }) => {
      if (error) console.warn("[search-analytics] insert failed:", error.message);
    });
}
