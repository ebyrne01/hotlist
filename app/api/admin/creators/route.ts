import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/api/require-admin";

/**
 * GET /api/admin/creators
 * Returns creator applications with applicant profile data, paginated.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "pending";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
  const offset = (page - 1) * limit;

  const supabase = getAdminClient();

  const { data, count, error } = await supabase
    .from("creator_applications")
    .select(
      `id, user_id, status, platform, handle_url, follower_count,
       content_description, created_at, reviewer_note, reviewed_at,
       claim_handle_id,
       profiles!inner(display_name, avatar_url, username)`,
      { count: "exact" }
    )
    .eq("status", status)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applications = (data || []).map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    status: row.status,
    platform: row.platform,
    handleUrl: row.handle_url,
    followerCount: row.follower_count,
    contentDescription: row.content_description,
    createdAt: row.created_at,
    reviewerNote: row.reviewer_note,
    reviewedAt: row.reviewed_at,
    claimHandleId: row.claim_handle_id,
    applicantName: row.profiles?.display_name || row.profiles?.username || "Unknown",
    applicantAvatar: row.profiles?.avatar_url,
  }));

  // Fetch counts for all statuses (for tabs)
  const [{ count: pendingCount }, { count: approvedCount }, { count: rejectedCount }] =
    await Promise.all([
      supabase.from("creator_applications").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("creator_applications").select("*", { count: "exact", head: true }).eq("status", "approved"),
      supabase.from("creator_applications").select("*", { count: "exact", head: true }).eq("status", "rejected"),
    ]);

  return NextResponse.json({
    applications,
    total: count ?? 0,
    page,
    limit,
    counts: {
      pending: pendingCount ?? 0,
      approved: approvedCount ?? 0,
      rejected: rejectedCount ?? 0,
    },
  });
}
