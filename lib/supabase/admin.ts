import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _adminClient: SupabaseClient | null = null;

/**
 * Server-side Supabase client using service_role key.
 * Singleton within a single Vercel function invocation.
 * Bypasses RLS — use only in server components, API routes, and lib functions.
 */
export function getAdminClient() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        global: {
          fetch: (...args) =>
            fetch(args[0], { ...args[1], cache: "no-store" }),
        },
      }
    );
  }
  return _adminClient;
}
