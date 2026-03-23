import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Checks that the current request is from an authenticated admin user.
 * Uses Supabase session auth — no service role key needed.
 *
 * Returns the user ID on success, or a NextResponse error to return immediately.
 */
export async function requireAdmin(): Promise<
  { userId: string } | { error: NextResponse }
> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) {
    return {
      error: NextResponse.json({ error: "Admin access required" }, { status: 403 }),
    };
  }

  return { userId: user.id };
}
