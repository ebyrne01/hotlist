import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/api/require-admin";

/**
 * POST /api/admin/quality/flags/bulk-resolve
 * Bulk-resolve multiple flags at once.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { flagIds, action, applyFix } = body as {
    flagIds: string[];
    action: "confirm" | "dismiss";
    applyFix?: boolean;
  };

  if (!Array.isArray(flagIds) || flagIds.length === 0) {
    return NextResponse.json({ error: "flagIds must be a non-empty array" }, { status: 400 });
  }
  if (!action || !["confirm", "dismiss"].includes(action)) {
    return NextResponse.json({ error: "action must be 'confirm' or 'dismiss'" }, { status: 400 });
  }

  const supabase = getAdminClient();
  let resolved = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const flagId of flagIds) {
    try {
      const { data: flag } = await supabase
        .from("quality_flags")
        .select("*")
        .eq("id", flagId)
        .single();

      if (!flag) {
        failed++;
        errors.push(`Flag ${flagId} not found`);
        continue;
      }

      if (action === "dismiss") {
        await supabase
          .from("quality_flags")
          .update({
            status: "dismissed",
            resolved_at: new Date().toISOString(),
            resolved_by: "admin",
          })
          .eq("id", flagId);
        resolved++;
      } else {
        // confirm
        if (applyFix && flag.auto_fixable) {
          const updateData: Record<string, unknown> = {};
          updateData[flag.field_name] = flag.suggested_value ?? null;

          const { error: updateError } = await supabase
            .from("books")
            .update(updateData)
            .eq("id", flag.book_id);

          if (updateError) {
            failed++;
            errors.push(`Flag ${flagId}: ${updateError.message}`);
            continue;
          }

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
        resolved++;
      }
    } catch (err) {
      failed++;
      errors.push(`Flag ${flagId}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  return NextResponse.json({ ok: true, resolved, failed, errors });
}
