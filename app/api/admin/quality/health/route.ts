import { NextResponse } from "next/server";
import { computeSourceHealth } from "@/lib/enrichment/health-check";
import { requireAdmin } from "@/lib/api/require-admin";

/**
 * GET /api/admin/quality/health
 * Returns enrichment source health metrics for the admin dashboard.
 */
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const health = await computeSourceHealth(24);
    return NextResponse.json(health);
  } catch (error) {
    console.error("[health] Failed:", error);
    return NextResponse.json({ error: "Failed to compute health" }, { status: 500 });
  }
}
