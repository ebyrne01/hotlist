import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using service_role key.
 * Bypasses RLS — use only in server components, API routes, and lib functions.
 * Disables Next.js fetch cache so we always get fresh data.
 */
export function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { fetch: (...args) => fetch(args[0], { ...args[1], cache: "no-store" }) } }
  );
}
