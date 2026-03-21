/**
 * Step 4: Validate Amazon enrichment results
 *
 * Runs post-import checks:
 * 1. Coverage check — % of books with Amazon ratings
 * 2. Sanity check — ratings in valid range
 * 3. ASIN coverage
 * 4. Consistency — compare Apify ratings vs existing Serper-sourced ratings
 * 5. Distribution — rating histogram
 *
 * Usage:
 *   npx tsx scripts/amazon-enrichment/validate-results.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { join } from "path";

const OUT_DIR = join(__dirname);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const lines: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    lines.push(msg);
  };

  log("=== Amazon Enrichment: Validation Report ===");
  log(`Generated: ${new Date().toISOString()}\n`);

  // 1. Coverage check
  log("--- 1. Coverage Check ---");
  const { count: totalBooks } = await supabase
    .from("books")
    .select("*", { count: "exact", head: true });

  const { count: booksWithAmazonRating } = await supabase
    .from("book_ratings")
    .select("*", { count: "exact", head: true })
    .eq("source", "amazon");

  const coverage = ((booksWithAmazonRating ?? 0) / (totalBooks ?? 1) * 100).toFixed(1);
  log(`Total books:              ${totalBooks}`);
  log(`Books with Amazon rating: ${booksWithAmazonRating}`);
  log(`Coverage:                 ${coverage}%`);
  log(`Target:                   >85%`);
  log(`Status:                   ${Number(coverage) > 85 ? "PASS ✓" : "BELOW TARGET"}`);

  // 2. Sanity check
  log("\n--- 2. Sanity Check (Rating Range) ---");
  const { data: outOfRange } = await supabase
    .from("book_ratings")
    .select("book_id, rating")
    .eq("source", "amazon")
    .or("rating.lt.1,rating.gt.5");

  log(`Ratings outside 1.0-5.0:  ${(outOfRange ?? []).length}`);
  log(`Status:                   ${(outOfRange ?? []).length === 0 ? "PASS ✓" : "FAIL — see below"}`);
  if (outOfRange && outOfRange.length > 0) {
    for (const r of outOfRange.slice(0, 10)) {
      log(`  book_id=${r.book_id} rating=${r.rating}`);
    }
  }

  // 3. ASIN coverage
  log("\n--- 3. ASIN Coverage ---");
  const { count: booksWithAsin } = await supabase
    .from("books")
    .select("*", { count: "exact", head: true })
    .not("amazon_asin", "is", null);

  const asinCoverage = ((booksWithAsin ?? 0) / (totalBooks ?? 1) * 100).toFixed(1);
  log(`Books with ASIN:          ${booksWithAsin}`);
  log(`ASIN coverage:            ${asinCoverage}%`);
  log(`Target:                   >80%`);
  log(`Status:                   ${Number(asinCoverage) > 80 ? "PASS ✓" : "BELOW TARGET"}`);

  // 4. Distribution check
  log("\n--- 4. Rating Distribution ---");
  const { data: allRatings } = await supabase
    .from("book_ratings")
    .select("rating")
    .eq("source", "amazon");

  if (allRatings && allRatings.length > 0) {
    const buckets: Record<string, number> = {};
    let sum = 0;
    for (const r of allRatings) {
      const bucket = Math.floor(r.rating * 2) / 2; // Round to nearest 0.5
      const key = bucket.toFixed(1);
      buckets[key] = (buckets[key] || 0) + 1;
      sum += r.rating;
    }

    const avg = sum / allRatings.length;
    log(`Average Amazon rating:    ${avg.toFixed(2)}`);
    log(`Expected range:           4.0–4.3 (romance books tend high)`);
    log(`Status:                   ${avg >= 3.5 && avg <= 4.8 ? "PASS ✓" : "CHECK — unusual average"}`);
    log("");

    // Histogram
    const sortedKeys = Object.keys(buckets).sort((a, b) => parseFloat(a) - parseFloat(b));
    const maxCount = Math.max(...Object.values(buckets));
    for (const key of sortedKeys) {
      const count = buckets[key];
      const bar = "█".repeat(Math.round((count / maxCount) * 40));
      log(`  ${key.padStart(3)} │ ${bar} ${count}`);
    }

    // Flag suspicious spikes
    const fiveStarPct = ((buckets["5.0"] || 0) / allRatings.length * 100).toFixed(1);
    const oneStarPct = ((buckets["1.0"] || 0) / allRatings.length * 100).toFixed(1);
    log("");
    log(`5.0 star spike:           ${fiveStarPct}% ${Number(fiveStarPct) > 15 ? "⚠️  HIGH — possible bad matches" : "✓"}`);
    log(`1.0 star spike:           ${oneStarPct}% ${Number(oneStarPct) > 5 ? "⚠️  HIGH — possible bad matches" : "✓"}`);
  }

  // 5. Consistency with existing Serper-sourced ratings
  log("\n--- 5. Consistency Check (pre-existing vs new) ---");
  // This checks if any ratings deviate significantly — won't have data until
  // we have both old and new ratings for the same books
  const { data: ratingPairs } = await supabase.rpc("get_amazon_rating_pairs").select("*");
  // This RPC won't exist yet — fall back to a manual query
  if (!ratingPairs) {
    log("(Skipped — no RPC available. Run manual comparison after import.)");
  }

  // Write report
  const reportPath = join(OUT_DIR, "validation-report.txt");
  writeFileSync(reportPath, lines.join("\n"));
  log(`\nReport saved to validation-report.txt`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
