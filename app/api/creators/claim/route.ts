import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

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

  const body = await req.json();
  const { creator_handle_id } = body as { creator_handle_id: string };

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
  const { data: existing } = await admin
    .from("creator_applications")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .limit(1);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (existing && (existing as any[]).length > 0) {
    return NextResponse.json({ error: "You already have a pending application" }, { status: 400 });
  }

  // Create the claim application
  const { error: insertError } = await admin
    .from("creator_applications")
    .insert({
      user_id: user.id,
      status: "pending",
      platform: h.platform,
      handle_url: h.handle,
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
