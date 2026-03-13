import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/analytics/event
 * Fire-and-forget analytics event tracking.
 * Used by client components to log profile views, affiliate clicks, etc.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { event_type, profile_id, hotlist_id, book_id, referrer } = body;

    if (!event_type || typeof event_type !== "string") {
      return NextResponse.json({ error: "event_type required" }, { status: 400 });
    }

    const supabase = getAdminClient();
    await supabase.from("analytics_events").insert({
      event_type,
      profile_id: profile_id || null,
      hotlist_id: hotlist_id || null,
      book_id: book_id || null,
      referrer: referrer || null,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
}
