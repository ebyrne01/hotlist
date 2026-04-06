/**
 * QUALITY SCORECARD
 *
 * Computes quality metrics for the canon book catalog.
 * Run monthly (or on-demand) to track coverage and quality trends.
 * Results stored in quality_health_log for trend analysis.
 */

import { getAdminClient } from "@/lib/supabase/admin";

export interface QualityScorecard {
  computedAt: string;
  canonCount: number;
  coverage: {
    cover: { count: number; pct: number };
    synopsis: { count: number; pct: number };
    goodreadsRating: { count: number; pct: number };
    amazonRating: { count: number; pct: number };
    romanceIoSpice: { count: number; pct: number };
    tropes: { count: number; pct: number };
    amazonAsin: { count: number; pct: number };
    aiRecommendations: { count: number; pct: number };
    subgenre: { count: number; pct: number };
  };
  flags: {
    openP0: number;
    openP1: number;
    openTotal: number;
  };
  enrichment: {
    complete: number;
    partial: number;
    pending: number;
  };
}

/**
 * Compute the quality scorecard for all canon books.
 */
export async function computeQualityScorecard(): Promise<QualityScorecard> {
  const supabase = getAdminClient();

  // All queries in parallel for speed
  const [
    canonResult,
    coverResult,
    synopsisResult,
    asinResult,
    enrichComplete,
    enrichPartial,
    enrichPending,
    grRatingResult,
    amzRatingResult,
    rioSpiceResult,
    tropeResult,
    recsResult,
    subgenreResult,
    flagP0Result,
    flagP1Result,
    flagTotalResult,
  ] = await Promise.all([
    // Total canon books
    supabase.from("books").select("*", { count: "exact", head: true }).eq("is_canon", true),
    // Cover coverage
    supabase.from("books").select("*", { count: "exact", head: true }).eq("is_canon", true).not("cover_url", "is", null),
    // Synopsis coverage
    supabase.from("books").select("*", { count: "exact", head: true }).eq("is_canon", true).not("ai_synopsis", "is", null),
    // Amazon ASIN coverage
    supabase.from("books").select("*", { count: "exact", head: true }).eq("is_canon", true).not("amazon_asin", "is", null),
    // Enrichment status breakdown
    supabase.from("books").select("*", { count: "exact", head: true }).eq("is_canon", true).eq("enrichment_status", "complete"),
    supabase.from("books").select("*", { count: "exact", head: true }).eq("is_canon", true).eq("enrichment_status", "partial"),
    supabase.from("books").select("*", { count: "exact", head: true }).eq("is_canon", true).eq("enrichment_status", "pending"),
    // Goodreads rating coverage (canon books with a goodreads rating row)
    supabase.rpc("count_canon_with_source", { source_name: "goodreads" }),
    // Amazon rating coverage
    supabase.rpc("count_canon_with_source", { source_name: "amazon" }),
    // Romance.io spice coverage
    supabase.rpc("count_canon_with_spice_source", { source_name: "romance_io" }),
    // Trope coverage (canon books with at least one trope)
    supabase.rpc("count_canon_with_tropes"),
    // AI recommendations coverage
    supabase.rpc("count_canon_with_recommendations"),
    // Subgenre coverage
    supabase.from("books").select("*", { count: "exact", head: true }).eq("is_canon", true).not("subgenre", "is", null),
    // Open quality flags
    supabase.from("quality_flags").select("*", { count: "exact", head: true }).eq("status", "open").eq("priority", "P0"),
    supabase.from("quality_flags").select("*", { count: "exact", head: true }).eq("status", "open").eq("priority", "P1"),
    supabase.from("quality_flags").select("*", { count: "exact", head: true }).eq("status", "open"),
  ]);

  const canonCount = canonResult.count ?? 0;
  const pct = (n: number) => canonCount > 0 ? Math.round((n / canonCount) * 1000) / 10 : 0;

  // For RPC results, extract data or fallback to 0
  const grCount = (grRatingResult.data as number) ?? 0;
  const amzCount = (amzRatingResult.data as number) ?? 0;
  const rioCount = (rioSpiceResult.data as number) ?? 0;
  const tropeCount = (tropeResult.data as number) ?? 0;
  const recsCount = (recsResult.data as number) ?? 0;

  return {
    computedAt: new Date().toISOString(),
    canonCount,
    coverage: {
      cover: { count: coverResult.count ?? 0, pct: pct(coverResult.count ?? 0) },
      synopsis: { count: synopsisResult.count ?? 0, pct: pct(synopsisResult.count ?? 0) },
      goodreadsRating: { count: grCount, pct: pct(grCount) },
      amazonRating: { count: amzCount, pct: pct(amzCount) },
      romanceIoSpice: { count: rioCount, pct: pct(rioCount) },
      tropes: { count: tropeCount, pct: pct(tropeCount) },
      amazonAsin: { count: asinResult.count ?? 0, pct: pct(asinResult.count ?? 0) },
      aiRecommendations: { count: recsCount, pct: pct(recsCount) },
      subgenre: { count: subgenreResult.count ?? 0, pct: pct(subgenreResult.count ?? 0) },
    },
    flags: {
      openP0: flagP0Result.count ?? 0,
      openP1: flagP1Result.count ?? 0,
      openTotal: flagTotalResult.count ?? 0,
    },
    enrichment: {
      complete: enrichComplete.count ?? 0,
      partial: enrichPartial.count ?? 0,
      pending: enrichPending.count ?? 0,
    },
  };
}

/**
 * Compute scorecard and store in quality_health_log.
 * Returns the scorecard for immediate display.
 */
export async function computeAndStoreScorecard(): Promise<QualityScorecard> {
  const scorecard = await computeQualityScorecard();
  const supabase = getAdminClient();

  await supabase.from("quality_health_log").insert({
    computed_at: scorecard.computedAt,
    canon_count: scorecard.canonCount,
    coverage: scorecard.coverage,
    flags: scorecard.flags,
    enrichment: scorecard.enrichment,
  }).then(({ error }) => {
    if (error) {
      // Table may not exist yet — log and continue
      console.warn("[scorecard] Failed to store scorecard:", error.message);
    }
  });

  return scorecard;
}
