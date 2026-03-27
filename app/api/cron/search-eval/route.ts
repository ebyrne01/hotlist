import { NextResponse } from "next/server";
import { requireCronAuth, cronUnauthorized } from "@/lib/api/cron-auth";
import { runSearchEval } from "@/lib/quality/search-eval";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Search quality eval cron — Tier 1 deterministic + DB audit.
 * Runs Sundays 4 AM UTC. Zero AI cost (no Sonnet calls).
 * Stores results in quality_health_log for trend tracking.
 */
export async function GET(request: Request) {
  if (!requireCronAuth(request)) {
    return cronUnauthorized();
  }

  try {
    const result = await runSearchEval();

    console.log(
      `[search-eval] Search: ${result.searchChecks.passed}/${result.searchChecks.total} passed. DB: ${result.dbChecks.passed}/${result.dbChecks.total} passed.`
    );

    // Log failures
    for (const check of result.searchChecks.details.filter(c => !c.passed)) {
      console.warn(`[search-eval] FAIL: ${check.query} — ${check.detail}`);
    }
    for (const check of result.dbChecks.details.filter(c => !c.passed)) {
      console.warn(`[search-eval] DB FAIL: ${check.book} — ${check.detail}`);
    }

    // Store in quality_health_log alongside scorecard data
    const supabase = getAdminClient();
    await supabase.from("quality_health_log").insert({
      computed_at: result.runAt,
      canon_count: 0, // not a scorecard run
      coverage: {},
      flags: {},
      enrichment: {},
      search_eval: {
        searchPassed: result.searchChecks.passed,
        searchTotal: result.searchChecks.total,
        dbPassed: result.dbChecks.passed,
        dbTotal: result.dbChecks.total,
        overallPass: result.overallPass,
        failures: [
          ...result.searchChecks.details.filter(c => !c.passed).map(c => ({ type: "search", query: c.query, detail: c.detail })),
          ...result.dbChecks.details.filter(c => !c.passed).map(c => ({ type: "db", book: c.book, detail: c.detail })),
        ],
      },
    }).then(({ error }) => {
      if (error) {
        console.warn("[search-eval] Failed to store results:", error.message);
      }
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/search-eval] Fatal error:", error);
    return NextResponse.json(
      { error: "Search eval failed" },
      { status: 500 }
    );
  }
}
