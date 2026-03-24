import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/api/require-admin";
import { demoteFromCanon } from "@/lib/books/canon-gate";

/**
 * GET /api/admin/quality/flags
 * Returns open quality flags with associated book data, paginated.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "open";
  const issueType = searchParams.get("issue_type");
  const priority = searchParams.get("priority");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
  const offset = (page - 1) * limit;

  const supabase = getAdminClient();

  // Build query — join with books for title/author/slug
  let query = supabase
    .from("quality_flags")
    .select(
      `id, book_id, field_name, issue_type, source, priority, rule_id,
       confidence, original_value, suggested_value, auto_fixable,
       status, created_at,
       books!inner(title, author, slug)`,
      { count: "exact" }
    )
    .eq("status", status)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (issueType) {
    query = query.eq("issue_type", issueType);
  }
  if (priority) {
    query = query.eq("priority", priority);
  }

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flags = (data || []).map((row: any) => ({
    id: row.id,
    bookId: row.book_id,
    bookTitle: row.books?.title,
    bookAuthor: row.books?.author,
    bookSlug: row.books?.slug,
    fieldName: row.field_name,
    issueType: row.issue_type,
    source: row.source,
    priority: row.priority,
    ruleId: row.rule_id,
    confidence: row.confidence,
    originalValue: row.original_value,
    suggestedValue: row.suggested_value,
    autoFixable: row.auto_fixable,
    status: row.status,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ flags, total: count ?? 0, page, limit });
}

/**
 * POST /api/admin/quality/flags
 * Create a quality flag from the book detail admin UI.
 * Triggers immediate corrective actions for critical issue types.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { bookId, issueType, notes } = body as {
    bookId: string;
    issueType: string;
    notes?: string;
  };

  if (!bookId || !issueType) {
    return NextResponse.json({ error: "bookId and issueType required" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Determine priority: wrong_book and junk_entry are P0 (auto-demote)
  const isDestructive = issueType === "wrong_book" || issueType === "junk_entry";
  const priority = isDestructive ? "P0" : "P1";

  // Insert the quality flag
  const { error: insertError } = await supabase.from("quality_flags").insert({
    book_id: bookId,
    field_name: issueType === "other" ? "general" : issueType,
    issue_type: issueType === "other" ? "manual_flag" : issueType,
    source: "admin_manual",
    confidence: 1.0,
    original_value: notes?.trim() || null,
    priority,
    auto_fixable: false,
    status: "open",
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // --- Immediate corrective actions ---
  const actions: string[] = [];

  // wrong_book / junk_entry → auto-demote from canon
  if (isDestructive) {
    await demoteFromCanon(bookId, `admin flagged as ${issueType}`);
    actions.push("demoted_from_canon");
  }

  // bad_synopsis → clear synopsis and re-queue generation
  if (issueType === "bad_synopsis") {
    await supabase
      .from("books")
      .update({ ai_synopsis: null })
      .eq("id", bookId);

    // Re-queue ai_synopsis enrichment job
    await supabase
      .from("enrichment_queue")
      .upsert(
        {
          book_id: bookId,
          job_type: "ai_synopsis",
          status: "pending",
          attempts: 0,
          max_attempts: 3,
          next_retry_at: new Date().toISOString(),
        },
        { onConflict: "book_id,job_type" }
      );

    actions.push("cleared_synopsis", "requeued_ai_synopsis");
  }

  // rating_accuracy → re-queue the relevant rating scraper
  if (issueType === "rating_accuracy") {
    // Re-queue all rating jobs so the freshest data is fetched
    for (const jobType of ["goodreads_rating", "amazon_rating", "romance_io_spice"] as const) {
      await supabase
        .from("enrichment_queue")
        .upsert(
          {
            book_id: bookId,
            job_type: jobType,
            status: "pending",
            attempts: 0,
            max_attempts: 5,
            next_retry_at: new Date().toISOString(),
          },
          { onConflict: "book_id,job_type" }
        );
    }
    actions.push("requeued_rating_jobs");
  }

  return NextResponse.json({ ok: true, priority, actions });
}
