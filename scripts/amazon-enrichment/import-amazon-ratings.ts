/**
 * Step 3: Import Amazon results to Supabase
 *
 * Reads amazon-results.json and upserts ratings + ASINs into Supabase.
 * Uses existing schema: book_ratings (source='amazon') + books.amazon_asin.
 * Does NOT overwrite existing Amazon ratings (preserves manually verified data).
 *
 * Usage:
 *   npx tsx scripts/amazon-enrichment/import-amazon-ratings.ts [--dry-run]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const DRY_RUN = process.argv.includes("--dry-run");
const OUT_DIR = join(__dirname);
const BATCH_SIZE = 100;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface AmazonResult {
  book_id: string;
  title: string;
  author: string;
  asin: string;
  amazon_rating: number;
  amazon_review_count: number;
  amazon_stars_breakdown: Record<string, number> | null;
  match_confidence: "high" | "medium" | "low";
  match_method: "asin" | "isbn" | "title";
}

async function main() {
  console.log("=== Amazon Enrichment: Import Results ===\n");

  const resultsPath = join(OUT_DIR, "amazon-results.json");
  if (!existsSync(resultsPath)) {
    console.error("amazon-results.json not found. Run fetch-amazon-ratings.ts first.");
    process.exit(1);
  }

  const results: AmazonResult[] = JSON.parse(readFileSync(resultsPath, "utf-8"));
  console.log(`Loaded ${results.length} results from amazon-results.json`);

  // Split by confidence
  const highMedium = results.filter((r) => r.match_confidence === "high" || r.match_confidence === "medium");
  const low = results.filter((r) => r.match_confidence === "low");
  console.log(`  High/Medium confidence: ${highMedium.length} (will import)`);
  console.log(`  Low confidence:         ${low.length} (manual review)`);

  // Write low-confidence to manual review file
  if (low.length > 0) {
    writeFileSync(join(OUT_DIR, "manual-review.json"), JSON.stringify(low, null, 2));
    console.log(`  Wrote ${low.length} low-confidence matches to manual-review.json`);
  }

  // Get existing Amazon ratings to avoid overwriting
  const { data: existingRatings } = await supabase
    .from("book_ratings")
    .select("book_id")
    .eq("source", "amazon");
  const existingRatingSet = new Set((existingRatings ?? []).map((r) => r.book_id));

  // Get existing ASINs
  const { data: existingAsins } = await supabase
    .from("books")
    .select("id, amazon_asin")
    .not("amazon_asin", "is", null);
  const existingAsinSet = new Set((existingAsins ?? []).map((r) => r.id));

  let ratingsInserted = 0;
  let ratingsSkipped = 0;
  let asinsUpdated = 0;
  let asinsSkipped = 0;
  let errors = 0;

  if (DRY_RUN) {
    const wouldInsertRatings = highMedium.filter((r) => !existingRatingSet.has(r.book_id) && r.amazon_rating > 0).length;
    const wouldUpdateAsins = highMedium.filter((r) => r.asin && !existingAsinSet.has(r.book_id)).length;
    console.log(`\n[dry-run] Would insert ${wouldInsertRatings} new ratings`);
    console.log(`[dry-run] Would update ${wouldUpdateAsins} new ASINs`);
    console.log(`[dry-run] Would skip ${highMedium.length - wouldInsertRatings} existing ratings`);
    return;
  }

  console.log(`\nImporting ${highMedium.length} results in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < highMedium.length; i += BATCH_SIZE) {
    const batch = highMedium.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    for (const result of batch) {
      try {
        // Upsert ASIN (always — even if rating already exists)
        if (result.asin && !existingAsinSet.has(result.book_id)) {
          const { error } = await supabase
            .from("books")
            .update({ amazon_asin: result.asin })
            .eq("id", result.book_id);
          if (error) throw error;
          asinsUpdated++;
          existingAsinSet.add(result.book_id);
        } else if (result.asin) {
          asinsSkipped++;
        }

        // Insert rating (only if no existing rating — preserve manual data)
        if (!existingRatingSet.has(result.book_id) && result.amazon_rating > 0) {
          const { error } = await supabase.from("book_ratings").upsert(
            {
              book_id: result.book_id,
              source: "amazon",
              rating: result.amazon_rating,
              rating_count: result.amazon_review_count,
              scraped_at: new Date().toISOString(),
            },
            { onConflict: "book_id,source" }
          );
          if (error) throw error;
          ratingsInserted++;
          existingRatingSet.add(result.book_id);
        } else {
          ratingsSkipped++;
        }
      } catch (err) {
        errors++;
        if (errors <= 10) {
          console.warn(`  Error on ${result.title}: ${err}`);
        }
      }
    }

    console.log(`  Batch ${batchNum}: processed ${Math.min(i + BATCH_SIZE, highMedium.length)}/${highMedium.length}`);
  }

  console.log("\n=== IMPORT SUMMARY ===");
  console.log(`Ratings inserted: ${ratingsInserted}`);
  console.log(`Ratings skipped:  ${ratingsSkipped} (already existed)`);
  console.log(`ASINs updated:    ${asinsUpdated}`);
  console.log(`ASINs skipped:    ${asinsSkipped} (already existed)`);
  console.log(`Errors:           ${errors}`);
  console.log(`Manual review:    ${low.length}`);
  console.log("\nDone! Run validate-results.ts next.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
