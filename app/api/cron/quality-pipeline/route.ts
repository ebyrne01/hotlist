import { NextResponse } from "next/server";
import { runAutoFixer } from "@/lib/quality/auto-fixer";
import { processGrabFeedback, processGrabCorrections } from "@/lib/quality/feedback-pipeline";
import { computeAndStoreScorecard } from "@/lib/quality/scorecard";
import { detectBatchRegressions } from "@/lib/quality/regression-detector";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Quality pipeline cron — auto-fixer, feedback processing, scorecard, regression detection.
 * Runs Sundays 3 AM UTC (1 hour after data-hygiene, so cleanup happens first).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Auto-fix high-confidence quality flags
    const autofix = await runAutoFixer();
    console.log(
      `[quality-pipeline] Auto-fixer: ${autofix.fixed} fixed, ${autofix.skipped} skipped, ${autofix.errors} errors`
    );

    // 2. Process user feedback → quality flags
    const feedback = await processGrabFeedback();
    console.log(
      `[quality-pipeline] Feedback: ${feedback.processed} processed, ${feedback.flagsCreated} flags created, ${feedback.escalatedToP0} escalated`
    );

    // 2b. Apply grab corrections — search for correct books, update grabs + hotlists
    const corrections = await processGrabCorrections();
    console.log(
      `[quality-pipeline] Corrections: ${corrections.processed} processed, ${corrections.corrected} corrected, ${corrections.hotlistsUpdated} hotlists updated`
    );
    if (corrections.failed.length > 0) {
      console.warn(`[quality-pipeline] Correction failures:`, corrections.failed);
    }

    // 3. Quality scorecard (trend tracking)
    const scorecard = await computeAndStoreScorecard();
    console.log(
      `[quality-pipeline] Scorecard: ${scorecard.canonCount} canon, ${scorecard.flags.openTotal} open flags`
    );

    // 4. Regression detector — check recent discovery batches for P0 spikes
    const regressions = await detectBatchRegressions();
    if (regressions.warnings.length > 0) {
      console.warn(`[quality-pipeline] REGRESSION WARNINGS:`, regressions.warnings);
    } else {
      console.log(
        `[quality-pipeline] Regression detector: ${regressions.batchesChecked} batches checked, no warnings`
      );
    }

    return NextResponse.json({ autofix, feedback, corrections, scorecard, regressions });
  } catch (error) {
    console.error("[cron/quality-pipeline] Fatal error:", error);
    return NextResponse.json(
      { error: "Quality pipeline failed" },
      { status: 500 }
    );
  }
}
