import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

interface PendingCreatorApplication {
  id: string;
  status: string;
  claim_handle_id: string | null;
}

/**
 * POST /api/creators/claim
 * Submit a claim request for an auto-generated creator handle.
 * Creates a creator_application with the claim_handle_id linked.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let creator_handle_id: string | null = null;
  try {
    const body = await req.json();
    creator_handle_id =
      typeof body?.creator_handle_id === "string" ? body.creator_handle_id : null;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!creator_handle_id) {
    return NextResponse.json({ error: "Missing creator_handle_id" }, { status: 400 });
  }

  const admin = getAdminClient();

  // Check if user is already a creator
  const { data: profile } = await admin
    .from("profiles")
    .select("is_creator")
    .eq("id", user.id)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((profile as any)?.is_creator) {
    return NextResponse.json({ error: "You are already a verified creator" }, { status: 400 });
  }

  // Check if handle exists and is unclaimed
  const { data: handle } = await admin
    .from("creator_handles")
    .select("id, handle, platform, claimed_by")
    .eq("id", creator_handle_id)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = handle as any;
  if (!h) {
    return NextResponse.json({ error: "Creator handle not found" }, { status: 404 });
  }
  if (h.claimed_by) {
    return NextResponse.json({ error: "This handle has already been claimed" }, { status: 400 });
  }

  // Check for existing pending application/claim
  const { data: existingForUser } = await admin
    .from("creator_applications")
    .select("id, status, claim_handle_id")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .limit(1);

  const pendingApplications =
    (existingForUser ?? []) as PendingCreatorApplication[];
  if (pendingApplications.length > 0) {
    const existing = pendingApplications[0];
    const sameClaim = existing.claim_handle_id === creator_handle_id;
    return NextResponse.json(
      {
        error: sameClaim
          ? "You already submitted a claim for this profile"
          : "You already have a pending creator application",
        status: "pending",
      },
      { status: 409 }
    );
  }

  // Check if another user already has a pending claim for this handle.
  const { data: existingForHandle } = await admin
    .from("creator_applications")
    .select("id")
    .eq("claim_handle_id", creator_handle_id)
    .eq("status", "pending")
    .limit(1);

  if (existingForHandle && existingForHandle.length > 0) {
    return NextResponse.json(
      {
        error: "A claim for this profile is already under review",
        status: "pending",
      },
      { status: 409 }
    );
  }

  // Create the claim application
  const { error: insertError } = await admin
    .from("creator_applications")
    .insert({
      user_id: user.id,
      status: "pending",
      platform: h.platform,
      handle: h.handle,
      follower_count: 0,
      content_description: `Claiming auto-generated profile @${h.handle}`,
      claim_handle_id: creator_handle_id,
    });

  if (insertError) {
    console.warn("[creators/claim] Insert failed:", insertError);
    return NextResponse.json({ error: "Failed to submit claim" }, { status: 500 });
  }

  return NextResponse.json({ status: "pending" });
}
