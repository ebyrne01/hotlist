/**
 * GET /api/reading-dna/me
 *
 * Returns the current user's Reading DNA profile.
 * Used by client components (ForYouRow, etc.) to access DNA data.
 */

import { createClient } from "@/lib/supabase/server";
import { getDna } from "@/lib/reading-dna";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ dna: null });
  }

  const dna = await getDna(user.id);
  return NextResponse.json({ dna });
}
