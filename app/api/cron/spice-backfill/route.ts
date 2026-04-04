/**
 * SPICE BACKFILL CRON — PAUSED
 *
 * LLM spice inference and review classifier backfills are paused.
 * Coverage is already high (96% review_classifier, 46% llm_spice)
 * and the cost savings outweigh incremental coverage gains.
 *
 * To re-enable, restore the previous implementation from git history.
 */

import { NextResponse } from "next/server";
import { requireCronAuth, cronUnauthorized } from "@/lib/api/cron-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!requireCronAuth(request)) {
    return cronUnauthorized();
  }

  return NextResponse.json({
    status: "paused",
    reason: "LLM spice backfill paused to reduce Haiku API costs",
  });
}
