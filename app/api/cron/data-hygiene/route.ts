import { NextResponse } from "next/server";
import { runDataHygiene } from "@/lib/books/data-hygiene";
import { runAutoFixer } from "@/lib/quality/auto-fixer";
import { processGrabFeedback } from "@/lib/quality/feedback-pipeline";
import { computeAndStoreScorecard } from "@/lib/quality/scorecard";
import { detectBatchRegressions } from "@/lib/quality/regression-detector";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Phase 1-5: Data hygiene (junk removal, dedup)
    const hygiene = await runDataHygiene();
    console.log(
      `[data-hygiene] Cleaned ${hygiene.deleted} junk entries, migrated ${hygiene.migrated} user refs, skipped ${hygiene.skippedWithUserData.length}`
    );
    if (hygiene.details.length > 0) {
      console.log(`[data-hygiene] Details:`, hygiene.details.join("; "));
    }
    if (hygiene.skippedWithUserData.length > 0) {
      console.log(
        `[data-hygiene] Skipped (has user data):`,
        hygiene.skippedWithUserData.join("; ")
      );
    }

    // Phase 6: Auto-fix high-confidence quality flags
    const autofix = await runAutoFixer();
    console.log(`[data-hygiene] Auto-fixer: ${autofix.fixed} fixed, ${autofix.skipped} skipped, ${autofix.errors} errors`);

    // Phase 7: Process user feedback → quality flags
    const feedback = await processGrabFeedback();
    console.log(`[data-hygiene] Feedback pipeline: ${feedback.processed} processed, ${feedback.flagsCreated} flags created, ${feedback.escalatedToP0} escalated`);

    // Phase 8: Quality scorecard (monthly trend tracking)
    const scorecard = await computeAndStoreScorecard();
    console.log(`[data-hygiene] Scorecard: ${scorecard.canonCount} canon books, ${scorecard.flags.openTotal} open flags`);

    // Phase 9: Regression detector — check recent discovery batches for P0 spikes
    const regressions = await detectBatchRegressions();
    if (regressions.warnings.length > 0) {
      console.warn(`[data-hygiene] REGRESSION WARNINGS:`, regressions.warnings);
    } else {
      console.log(`[data-hygiene] Regression detector: ${regressions.batchesChecked} batches checked, no warnings`);
    }

    return NextResponse.json({
      hygiene,
      autofix,
      feedback,
      scorecard,
      regressions,
    });
  } catch (error) {
    console.error("[cron/data-hygiene] Fatal error:", error);
    return NextResponse.json(
      { error: "Data hygiene failed" },
      { status: 500 }
    );
  }
}
