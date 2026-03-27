import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserHotlists } from "@/lib/hotlists";

/**
 * GET /api/homepage/hotlists
 * Returns the current user's hotlists for the homepage bar.
 * Session-based auth via cookie — returns 401 if not logged in.
 */
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json([], { status: 401 });
  }

  const hotlists = await getUserHotlists(supabase, user.id);
  return NextResponse.json(hotlists);
}
