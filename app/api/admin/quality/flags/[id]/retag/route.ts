import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;
}

/**
 * POST /api/admin/quality/flags/[id]/retag
 * Updates the issue_type on a quality flag so admins can reclassify
 * mislabeled flags during triage.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
