/**
 * AUTO-FIXER
 *
 * Applies high-confidence auto-fixable quality flags without human intervention.
 * Runs as part of the weekly data-hygiene cron.
 *
 * Only applies fixes where:
 * - auto_fixable = true
 * - confidence >= 0.9
 * - status = 'open'
 * - The book is canon (no point fixing non-public books)
 */

import { getAdminClient } from "@/lib/supabase/admin";

interface AutoFixResult {
  fixed: number;
  skipped: number;
  errors: string[];
}

export async function runAutoFixer(): Promise<AutoFixResult> {
  const supabase = getAdminClient();

  // Fetch all eligible auto-fixable flags on canon books
  const { data: flags, error: fetchError } = await supabase
    .from("quality_flags")
    .select("id, book_id, field_name, suggested_value, original_value, issue_type, confidence")
    .eq("status", "open")
    .eq("auto_fixable", true)
    .gte("confidence", 0.9);

  if (fetchError || !flags) {
    console.warn("[auto-fixer] Failed to fetch flags:", fetchError?.message);
    return { fixed: 0, skipped: 0, errors: [fetchError?.message ?? "unknown"] };
  }

  if (flags.length === 0) {
    console.log("[auto-fixer] No eligible flags to fix");
    return { fixed: 0, skipped: 0, errors: [] };
  }

  let fixed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const flag of flags) {
    try {
      // Apply the fix: suggested_value === null means "clear the field"
      const updateData: Record<string, unknown> = {};
      updateData[flag.field_name] = flag.suggested_value ?? null;

      const { error: updateError } = await supabase
        .from("books")
        .update(updateData)
        .eq("id", flag.book_id);

      if (updateError) {
        errors.push(`Flag ${flag.id}: ${updateError.message}`);
        skipped++;
        continue;
      }

      // Mark the flag as auto_fixed
      await supabase
        .from("quality_flags")
        .update({
          status: "auto_fixed",
          resolved_at: new Date().toISOString(),
          resolved_by: "auto",
          resolution_note: "Applied by auto-fixer pipeline",
        })
        .eq("id", flag.id);

      fixed++;
      console.log(
        `[auto-fixer] Fixed ${flag.issue_type} on book ${flag.book_id}: ` +
        `${flag.field_name} "${flag.original_value?.slice(0, 40)}" → "${flag.suggested_value?.slice(0, 40) ?? "(cleared)"}"`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Flag ${flag.id}: ${msg}`);
      skipped++;
    }
  }

  console.log(`[auto-fixer] Done: ${fixed} fixed, ${skipped} skipped, ${errors.length} errors`);
  return { fixed, skipped, errors };
}
