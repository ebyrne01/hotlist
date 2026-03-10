/**
 * SEED FROM OPEN LIBRARY SUBJECTS
 *
 * Crawls Open Library romance subjects and seeds the database
 * with books resolved to Goodreads IDs. Designed to be run manually:
 *
 *   npx tsx scripts/seed-from-openlibrary.ts
 *
 * Time budget: 15 minutes max.
 * Rate limits: 1 req/sec (Open Library), 1.5s (Goodreads).
 */

import "dotenv/config";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function main() {
  const { OL_SUBJECTS, crawlSubject, processOLWorks } = await import(
    "../lib/books/open-library-discovery"
  );

  const TIME_BUDGET_MS = 15 * 60 * 1000; // 15 minutes
  const startTime = Date.now();

  console.log(`[ol-seed] Starting seed from ${OL_SUBJECTS.length} Open Library subjects`);
  console.log(`[ol-seed] Time budget: ${TIME_BUDGET_MS / 1000}s`);
  console.log("");

  let totalAdded = 0;
  let totalProcessed = 0;
  let totalResolved = 0;
  let totalSkipped = 0;

  for (const subject of OL_SUBJECTS) {
    const elapsed = Date.now() - startTime;
    if (elapsed > TIME_BUDGET_MS) {
      console.log(`\n[ol-seed] Time budget reached. Stopping.`);
      break;
    }

    console.log(`\n── Crawling subject: ${subject} ──`);

    const works = await crawlSubject(subject, 4, 50);
    console.log(`   Found ${works.length} works`);

    if (works.length === 0) continue;

    const remainingMs = TIME_BUDGET_MS - (Date.now() - startTime);
    const progress = await processOLWorks(
      works,
      remainingMs,
      (msg) => console.log(`   ${msg}`)
    );

    totalAdded += progress.added;
    totalProcessed += progress.processed;
    totalResolved += progress.resolved;
    totalSkipped += progress.skipped;

    console.log(
      `   Done: ${progress.added} new, ${progress.resolved} resolved, ${progress.skipped} skipped, ${progress.errors} errors`
    );
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[ol-seed] Done in ${duration}s`);
  console.log(
    `[ol-seed] Total: ${totalAdded} added, ${totalResolved} resolved, ${totalSkipped} skipped, ${totalProcessed} processed`
  );

  // Record last run timestamp
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  await supabase.from("homepage_cache").upsert(
    {
      cache_key: "ol_discovery_last_run",
      book_ids: [],
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "cache_key" }
  );
}

main().catch((err) => {
  console.error("[ol-seed] Fatal error:", err);
  process.exit(1);
});
