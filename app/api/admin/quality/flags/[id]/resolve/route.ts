import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkGraduationThreshold } from "@/lib/quality/rules-engine";
import { requireAdmin } from "@/lib/api/require-admin";

/**
 * POST /api/admin/quality/flags/[id]/resolve
 * Resolves a single quality flag — confirm (with optional fix) or dismiss.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { id: flagId } = await params;
  const body = await req.json();
  const { action, applyFix } = body as {
    action: "confirm" | "dismiss";
    applyFix?: boolean;
  };

  if (!action || !["confirm", "dismiss"].includes(action)) {
    return NextResponse.json(
      { error: "action must be 'confirm' or 'dismiss'" },
      { status: 400 }
    );
  }

  const supabase = getAdminClient();

  // Fetch the flag
  const { data: flag, error: fetchError } = await supabase
    .from("quality_flags")
    .select("*")
    .eq("id", flagId)
    .single();

  if (fetchError || !flag) {
    return NextResponse.json({ error: "Flag not found" }, { status: 404 });
  }

  let fixApplied = false;

  if (action === "dismiss") {
    await supabase
      .from("quality_flags")
      .update({
        status: "dismissed",
        resolved_at: new Date().toISOString(),
        resolved_by: "admin",
      })
      .eq("id", flagId);
  } else {
    // action === "confirm"
    if (applyFix && flag.auto_fixable) {
      // Apply the suggested fix to the book
      const updateData: Record<string, unknown> = {};
      // suggested_value === null means "clear the field"
      updateData[flag.field_name] = flag.suggested_value ?? null;

      const { error: updateError } = await supabase
        .from("books")
        .update(updateData)
        .eq("id", flag.book_id);

      if (updateError) {
        return NextResponse.json(
          { error: `Failed to apply fix: ${updateError.message}` },
          { status: 500 }
        );
      }

      fixApplied = true;

      await supabase
        .from("quality_flags")
        .update({
          status: "auto_fixed",
          resolved_at: new Date().toISOString(),
          resolved_by: "admin",
        })
        .eq("id", flagId);
    } else {
      await supabase
        .from("quality_flags")
        .update({
          status: "confirmed",
          resolved_at: new Date().toISOString(),
          resolved_by: "admin",
        })
        .eq("id", flagId);
    }
  }

  // Check for pattern graduation on confirmed Haiku flags
  if (action === "confirm" && flag.source === "haiku_scanner") {
    const shouldGraduate = await checkGraduationThreshold(flag.issue_type);
    if (shouldGraduate) {
      console.log(
        `[quality] Issue type "${flag.issue_type}" has been confirmed 5+ times — consider adding it to the rules engine in lib/quality/rules-engine.ts`
      );
    }
  }

  return NextResponse.json({ ok: true, flagId, action, fixApplied });
}
