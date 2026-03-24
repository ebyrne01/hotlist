import { NextResponse } from "next/server";
import { computeQualityScorecard } from "@/lib/quality/scorecard";
import { requireAdmin } from "@/lib/api/require-admin";

/**
 * GET /api/admin/quality/scorecard
 * Returns the current quality scorecard (computed on-demand).
 */
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const scorecard = await computeQualityScorecard();
    return NextResponse.json(scorecard);
  } catch (error) {
    console.error("[scorecard] Failed:", error);
    return NextResponse.json({ error: "Failed to compute scorecard" }, { status: 500 });
  }
}
