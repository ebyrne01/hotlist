import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _adminClient: SupabaseClient | null = null;

/**
 * Server-side Supabase client using service_role key.
 * Singleton within a single Vercel function invocation.
 * Bypasses RLS — use only in server components, API routes, and lib functions.
 *
 * No cache: "no-store" override — caching is controlled at the page level:
 * - ISR pages use `export const revalidate = N` (data cached, refreshed on schedule)
 * - Dynamic pages use `export const dynamic = "force-dynamic"` (fresh on every request)
 */
export function getAdminClient() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}
