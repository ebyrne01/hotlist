import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/api/require-admin";

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
