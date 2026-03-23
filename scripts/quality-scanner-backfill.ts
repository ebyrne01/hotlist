/**
 * QUALITY SCANNER BACKFILL
 *
 * Runs Haiku quality checks on all fully-enriched books that haven't been
 * scanned yet. Throttled at ~50 books/minute to respect Haiku rate limits.
 *
 * Usage:
 *   npx tsx scripts/quality-scanner-backfill.ts              # all unscanned
 *   npx tsx scripts/quality-scanner-backfill.ts --limit 200  # first 200
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { scanBook } from "../lib/quality/haiku-scanner";

const INTER_BOOK_DELAY_MS = 1200; // 50 books/min max — 1200ms delay = ~50 books/min

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anthropicKey = process.env.ANTHROPIC_API_KEY!;

if (!supabaseUrl || !supabaseKey || !anthropicKey) {
  console.error("Missing required env vars (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY)");
  process.exit(1);
}

async function main() {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const client = new Anthropic({ apiKey: anthropicKey });

  const limitArg =
    process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ??
    process.argv[process.argv.indexOf("--limit") + 1];
  const limit = limitArg ? Number(limitArg) : Infinity;

  console.log("Hotlist Quality Scanner Backfill");
  console.log("================================");

  // Find all complete books that haven't been scanned yet
  // Uses last_quality_scan column to track scan status (not quality_flags,
  // since books that pass cleanly don't get flags)
  const { data: unscannedBooks } = await supabase
    .from("books")
    .select("id, title, author")
    .eq("enrichment_status", "complete")
    .is("last_quality_scan", null)
    .order("updated_at", { ascending: false });

  if (!unscannedBooks || unscannedBooks.length === 0) {
    console.log("All complete books have been scanned.");
    return;
  }

  // Also get total counts for display
  const { count: totalComplete } = await supabase
    .from("books")
    .select("*", { count: "exact", head: true })
    .eq("enrichment_status", "complete");

  const alreadyScanned = (totalComplete ?? 0) - unscannedBooks.length;
  const toProcess = unscannedBooks.slice(0, Number.isFinite(limit) ? limit : unscannedBooks.length);

  const estMinutes = Math.ceil((toProcess.length * INTER_BOOK_DELAY_MS) / 60_000);
  console.log(`Complete books: ${totalComplete}`);
  console.log(`Already scanned: ${alreadyScanned}`);
  console.log(`To process: ${toProcess.length}`);
  console.log(`Estimated time: ~${estMinutes} min at ${Math.round(60_000 / INTER_BOOK_DELAY_MS)} books/min`);
  console.log(`Started: ${new Date().toLocaleString()}\n`);

  let processed = 0;
  let totalFlagged = 0;

  for (const book of toProcess) {
    const label = book.title.substring(0, 50).padEnd(50);
    process.stdout.write(`[${processed + 1}/${toProcess.length}] ${label} `);

    try {
      const result = await scanBook(client, book.id);
      processed++;
      totalFlagged += result.flagged;

      // Mark as scanned regardless of outcome (even if no flags)
      await supabase
        .from("books")
        .update({ last_quality_scan: new Date().toISOString() })
        .eq("id", book.id);

      if (result.flagged > 0) {
        process.stdout.write(`>> ${result.flagged} flags\n`);
      } else {
        process.stdout.write(`ok\n`);
      }
    } catch (err) {
      process.stdout.write(`ERROR: ${err instanceof Error ? err.message : err}\n`);
    }

    await new Promise((r) => setTimeout(r, INTER_BOOK_DELAY_MS));
  }

  console.log("\n================================");
  console.log(`Scanned ${processed} books`);
  console.log(`Total flags created: ${totalFlagged}`);
  console.log(`Finished: ${new Date().toLocaleString()}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
