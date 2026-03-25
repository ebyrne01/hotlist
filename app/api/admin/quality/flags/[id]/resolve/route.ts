import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkGraduationThreshold } from "@/lib/quality/rules-engine";
import { tryPromoteToCanon } from "@/lib/books/canon-gate";
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
  const { action, applyFix, newGoodreadsId } = body as {
    action: "confirm" | "dismiss";
    applyFix?: boolean;
    newGoodreadsId?: string;
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

  // Remap Goodreads ID: clear stale GR data, set new ID, re-queue enrichment
  const GR_REMAP_ISSUE_TYPES = ["goodreads_wrong_book", "wrong_book", "wrong_edition", "goodreads_foreign_edition", "foreign_edition"];
  if (action === "confirm" && newGoodreadsId && GR_REMAP_ISSUE_TYPES.includes(flag.issue_type)) {
    const grId = newGoodreadsId.trim();

    // Check for dupe — another book already has this GR ID
    const { data: existing } = await supabase
      .from("books")
      .select("id, title")
      .eq("goodreads_id", grId)
      .neq("id", flag.book_id)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: `Another book already has Goodreads ID ${grId}: "${existing[0].title}" (${existing[0].id})` },
        { status: 409 }
      );
    }

    // Clear GR-derived fields and set new ID
    const { error: updateError } = await supabase
      .from("books")
      .update({
        goodreads_id: grId,
        goodreads_url: null,
        description: null,
        genres: [],
        series_name: null,
        series_position: null,
        page_count: null,
        published_year: null,
        data_refreshed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", flag.book_id);

    if (updateError) {
      return NextResponse.json(
        { error: `Failed to remap Goodreads ID: ${updateError.message}` },
        { status: 500 }
      );
    }

    // Delete stale GR rating
    await supabase
      .from("book_ratings")
      .delete()
      .eq("book_id", flag.book_id)
      .eq("source", "goodreads");

    // Re-queue goodreads_detail + goodreads_rating
    for (const jobType of ["goodreads_detail", "goodreads_rating"]) {
      await supabase.from("enrichment_queue").upsert(
        {
          book_id: flag.book_id,
          job_type: jobType,
          status: "pending",
          attempts: 0,
          max_attempts: jobType === "goodreads_rating" ? 5 : 3,
          next_retry_at: new Date().toISOString(),
        },
        { onConflict: "book_id,job_type" }
      );
    }

    fixApplied = true;

    await supabase
      .from("quality_flags")
      .update({
        status: "confirmed",
        resolved_at: new Date().toISOString(),
        resolved_by: "admin",
        suggested_value: grId,
      })
      .eq("id", flagId);

    console.log(`[quality] Remapped book ${flag.book_id} to Goodreads ID ${grId}, re-queued enrichment`);

    return NextResponse.json({ ok: true, flagId, action, fixApplied, remappedTo: grId });
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

  // When dismissing a wrong_book/junk_entry flag, re-evaluate for canon promotion
  // (the book was demoted when flagged — dismissal means admin disagrees)
  const DEMOTING_ISSUE_TYPES = ["wrong_book", "junk_entry", "goodreads_wrong_book", "foreign_edition"];
  if (action === "dismiss" && DEMOTING_ISSUE_TYPES.includes(flag.issue_type)) {
    const promoted = await tryPromoteToCanon(flag.book_id);
    if (promoted) {
      console.log(`[quality] Re-promoted book ${flag.book_id} after dismissing ${flag.issue_type} flag`);
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
