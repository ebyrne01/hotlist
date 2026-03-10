/**
 * SEED FROM GOODREADS LISTS
 *
 * Crawls curated Goodreads romance/romantasy lists and seeds the database
 * with every book found. Designed to be run manually:
 *
 *   npx tsx scripts/seed-from-lists.ts
 *
 * Time budget: 10 minutes max.
 * Rate limit: 1.5s between Goodreads requests.
 */

import "dotenv/config";

// Set up env for @/lib imports
import { createClient } from "@supabase/supabase-js";

// We can't use path aliases in tsx scripts, so we need to set up the admin client
// directly. The rest of the imports use relative paths.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Patch the global admin client before importing lib modules
// This is a workaround for path aliases not working in tsx scripts
process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
process.env.SUPABASE_SERVICE_ROLE_KEY = supabaseServiceKey;

async function main() {
  // Dynamic imports to ensure env is set up first
  // Use relative paths from scripts/ to lib/
  const { SEED_LIST_URLS, crawlList, processListEntries } = await import(
    "../lib/books/list-crawler"
  );

  const TIME_BUDGET_MS = 10 * 60 * 1000; // 10 minutes
  const startTime = Date.now();

  console.log(`[seed-lists] Starting seed from ${SEED_LIST_URLS.length} Goodreads lists`);
  console.log(`[seed-lists] Time budget: ${TIME_BUDGET_MS / 1000}s`);
  console.log("");

  let totalAdded = 0;
  let totalProcessed = 0;
  let totalSkipped = 0;

  for (const listUrl of SEED_LIST_URLS) {
    const elapsed = Date.now() - startTime;
    if (elapsed > TIME_BUDGET_MS) {
      console.log(`\n[seed-lists] Time budget reached. Stopping.`);
      break;
    }

    const listName = listUrl.split("/").pop()?.replace(/_/g, " ") ?? listUrl;
    console.log(`\n── Crawling: ${listName} ──`);

    const entries = await crawlList(listUrl, 3);
    console.log(`   Found ${entries.length} books on list`);

    if (entries.length === 0) continue;

    const remainingMs = TIME_BUDGET_MS - (Date.now() - startTime);
    const progress = await processListEntries(
      entries,
      remainingMs,
      (msg) => console.log(`   ${msg}`)
    );

    totalAdded += progress.added;
    totalProcessed += progress.processed;
    totalSkipped += progress.skipped;

    console.log(
      `   ✓ ${progress.added} new, ${progress.skipped} skipped, ${progress.errors} errors`
    );
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[seed-lists] Done in ${duration}s`);
  console.log(`[seed-lists] Total: ${totalAdded} added, ${totalSkipped} skipped, ${totalProcessed} processed`);

  // Record last run timestamp
  const { createClient: createSupabase } = await import("@supabase/supabase-js");
  const supabase = createSupabase(supabaseUrl, supabaseServiceKey);
  await supabase.from("homepage_cache").upsert(
    {
      cache_key: "seed_lists_last_run",
      book_ids: [],
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "cache_key" }
  );
}

main().catch((err) => {
  console.error("[seed-lists] Fatal error:", err);
  process.exit(1);
});
