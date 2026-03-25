/**
 * GET /api/tropes?slugs=enemies-to-lovers,slow-burn
 *
 * Returns trope display names for given slugs.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const slugsParam = request.nextUrl.searchParams.get("slugs");
  if (!slugsParam) {
    return NextResponse.json({ tropes: [] });
  }

  const slugs = slugsParam.split(",").filter(Boolean).slice(0, 20);
  if (slugs.length === 0) {
    return NextResponse.json({ tropes: [] });
  }

  const supabase = getAdminClient();
  const { data } = await supabase
    .from("tropes")
    .select("slug, name")
    .in("slug", slugs);

  return NextResponse.json({ tropes: data ?? [] });
}
