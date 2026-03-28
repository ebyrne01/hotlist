import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/api/require-admin";

/**
 * POST /api/admin/creators/[id]/review
 * Approve or reject a creator application.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const body = await req.json();
  const { action, note } = body as { action: "approve" | "reject"; note?: string };

  if (!action || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Fetch the application
  const { data: application, error: fetchError } = await supabase
    .from("creator_applications")
    .select("id, user_id, status, platform, handle_url, claim_handle_id")
    .eq("id", id)
    .single();

  if (fetchError || !application) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = application as any;

  if (app.status !== "pending") {
    return NextResponse.json(
      { error: `Application already ${app.status}` },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  if (action === "approve") {
    // Update application status
    await supabase
      .from("creator_applications")
      .update({ status: "approved", reviewed_at: now })
      .eq("id", id);

    // Set profile as creator
    const profileUpdate: Record<string, unknown> = {
      is_creator: true,
      creator_verified_at: now,
    };

    // Pre-fill the social handle based on platform
    if (app.handle_url) {
      const handle = app.handle_url.replace(/^@/, "");
      if (app.platform === "tiktok") profileUpdate.tiktok_handle = handle;
      else if (app.platform === "instagram") profileUpdate.instagram_handle = handle;
      else if (app.platform === "youtube") profileUpdate.youtube_handle = handle;
      else if (app.platform === "blog") profileUpdate.blog_url = app.handle_url;
    }

    await supabase
      .from("profiles")
      .update(profileUpdate)
      .eq("id", app.user_id);

    // If this is a claim, link the creator handle to the user
    if (app.claim_handle_id) {
      await supabase
        .from("creator_handles")
        .update({ claimed_by: app.user_id })
        .eq("id", app.claim_handle_id);
    }

    return NextResponse.json({ status: "approved" });
  }

  // Reject
  await supabase
    .from("creator_applications")
    .update({
      status: "rejected",
      reviewer_note: note || null,
      reviewed_at: now,
    })
    .eq("id", id);

  return NextResponse.json({ status: "rejected" });
}
