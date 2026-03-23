import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/api/require-admin";

/**
 * POST /api/admin/quality/flags/[id]/retag
 * Updates the issue_type on a quality flag so admins can reclassify
 * mislabeled flags during triage.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { id: flagId } = await params;
  const body = await req.json();
  const { issueType } = body as { issueType: string };

  if (!issueType || typeof issueType !== "string") {
    return NextResponse.json(
      { error: "issueType is required" },
      { status: 400 }
    );
  }

  const supabase = getAdminClient();

  const { error } = await supabase
    .from("quality_flags")
    .update({ issue_type: issueType })
    .eq("id", flagId);

  if (error) {
    return NextResponse.json(
      { error: `Failed to retag: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, flagId, issueType });
}
