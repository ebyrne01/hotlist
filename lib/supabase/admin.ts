import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _adminClient: SupabaseClient | null = null;
let _readOnlyClient: SupabaseClient | null = null;

/**
 * Server-side Supabase client using service_role key.
 * Singleton within a single Vercel function invocation.
 * Bypasses RLS — use only in API routes, cron jobs, and lib functions.
 *
 * Uses cache: "no-store" to prevent Next.js from caching fetch results
 * within a single function invocation. This is critical for daily limit
 * checks in the enrichment worker — without it, the count query returns
 * a stale cached value and limits never trigger.
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

/**
 * Read-only Supabase client for ISR pages.
 * Same service_role access but WITHOUT cache: "no-store", so Next.js
 * can statically generate and revalidate these pages on schedule.
 *
 * Use this ONLY in pages with `export const revalidate = N`.
 */
export function getReadOnlyClient() {
  if (!_readOnlyClient) {
    _readOnlyClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _readOnlyClient;
}
