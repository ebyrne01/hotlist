/**
 * POST /api/search/feedback
 *
 * Records thumbs-up/down feedback on NL search results.
 * Anonymous — no auth required (same pattern as grab_feedback).
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { checkOrigin } from "@/lib/api/cors";

export async function POST(request: NextRequest) {
  if (!checkOrigin(request)) {
    return NextResponse.json({ error: "Unauthorized origin" }, { status: 403 });
  }

  try {
    const { analyticsId, feedback, note } = await request.json();

    if (!analyticsId || (feedback !== 1 && feedback !== -1)) {
      return NextResponse.json(
        { error: "analyticsId and feedback (1 or -1) required" },
        { status: 400 }
      );
    }

    const supabase = getAdminClient();
    const { error } = await supabase
      .from("search_analytics")
      .update({
        feedback,
        feedback_note: note || null,
      })
      .eq("id", analyticsId);

    if (error) {
      console.error("[search-feedback] update failed:", error.message);
      return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
