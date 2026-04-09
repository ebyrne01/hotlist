/**
 * Local runner: burn through pending amazon_rating enrichment jobs.
 *
 * Runs the enrichment worker in a tight loop, processing ONLY amazon_rating
 * jobs. No 5-min cron gap — just hammers through the backlog.
 *
 * Each job calls Serper to search for the book on Amazon, extracting
 * the ASIN (and rating if available). ~90% ASIN hit rate.
 *
 * Usage:
 *   npx tsx scripts/amazon-enrichment/burn-amazon-queue.ts
 *   npx tsx scripts/amazon-enrichment/burn-amazon-queue.ts --limit 500
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { claimJobs, markJobCompleted, markJobFailed, updateBookEnrichmentStatus } from "@/lib/enrichment/queue";
import { getAmazonRatingViaSerper } from "@/lib/scraping/amazon-search";
import { getAdminClient } from "@/lib/supabase/admin";

const CONCURRENCY = 5;
const DELAY_BETWEEN_BATCHES_MS = 500; // Respect Serper rate limits
const DEFAULT_LIMIT = 99999; // Process all by default

const limitArg = process.argv.find((a) => a.startsWith("--limit"));
const LIMIT = limitArg ? parseInt(process.argv[process.argv.indexOf(limitArg) + 1], 10) : DEFAULT_LIMIT;

async function processAmazonJob(job: {
  id: string;
  book_id: string;
  book_title?: string;
  book_author?: string;
  book_isbn?: string;
  attempts: number;
}) {
  const supabase = getAdminClient();
  const { book_id, book_title, book_author, book_isbn } = job;

  if (!book_title || !book_author) {
    throw new Error("Missing title or author");
  }

  const amazonData = await getAmazonRatingViaSerper(book_title, book_author, book_isbn);

  if (amazonData) {
    // Save ASIN even when rating extraction fails
    if (amazonData.asin) {
      await supabase.from("books").update({ amazon_asin: amazonData.asin }).eq("id", book_id);
    }
    if (amazonData.rating > 0) {
      await supabase.from("book_ratings").upsert(
        {
          book_id,
          source: "amazon",
          rating: amazonData.rating,
          rating_count: amazonData.ratingCount,
          scraped_at: new Date().toISOString(),
        },
        { onConflict: "book_id,source" }
      );
    }
  }
}

async function main() {
  console.log("=== Amazon Queue Burner ===");
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Limit: ${LIMIT === DEFAULT_LIMIT ? "all" : LIMIT}`);
  console.log();

  let totalProcessed = 0;
  let totalFailed = 0;
  let totalAsins = 0;
  let totalRatings = 0;
  const startTime = Date.now();

  // Check how many are pending
  const supabase = getAdminClient();
  const { count } = await supabase
    .from("enrichment_queue")
    .select("*", { count: "exact", head: true })
    .eq("job_type", "amazon_rating")
    .eq("status", "pending");

  console.log(`Pending amazon_rating jobs: ${count}`);
  const target = Math.min(count ?? 0, LIMIT);
  console.log(`Will process: ${target}\n`);

  while (totalProcessed + totalFailed < target) {
    const batchSize = Math.min(CONCURRENCY, target - totalProcessed - totalFailed);
    const jobs = await claimJobs(batchSize, ["amazon_rating"]);

    if (jobs.length === 0) {
      console.log("No more jobs to claim. Done.");
      break;
    }

    const results = await Promise.allSettled(
      jobs.map(async (job) => {
        try {
          await processAmazonJob(job);
          await markJobCompleted(job.id);
          await updateBookEnrichmentStatus(job.book_id);

          // Check what we got
          const { data: book } = await supabase
            .from("books")
            .select("amazon_asin")
            .eq("id", job.book_id)
            .single();
          const gotAsin = !!book?.amazon_asin;

          const { data: rating } = await supabase
            .from("book_ratings")
            .select("rating")
            .eq("book_id", job.book_id)
            .eq("source", "amazon")
            .maybeSingle();
          const gotRating = !!rating?.rating;

          return { success: true, asin: gotAsin, rating: gotRating, title: job.book_title } as const;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await markJobFailed(job.id, msg, job.attempts);
          return { success: false, title: job.book_title, error: msg } as const;
        }
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value.success) {
          totalProcessed++;
          if (r.value.asin) totalAsins++;
          if (r.value.rating) totalRatings++;
        } else {
          totalFailed++;
          if (totalFailed <= 5) {
            console.warn(`  FAIL: "${r.value.title}" — ${r.value.error}`);
          }
        }
      } else {
        totalFailed++;
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (totalProcessed / ((Date.now() - startTime) / 1000)).toFixed(1);
    const remaining = target - totalProcessed - totalFailed;
    const eta = remaining > 0 && parseFloat(rate) > 0
      ? Math.round(remaining / parseFloat(rate) / 60)
      : 0;

    process.stdout.write(
      `\r  ${totalProcessed + totalFailed}/${target} | ${totalAsins} ASINs | ${totalRatings} ratings | ${rate}/s | ~${eta}min left | ${elapsed}s elapsed`
    );

    // Brief pause to respect rate limits
    await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
  }

  console.log("\n\n=== SUMMARY ===");
  console.log(`Processed:  ${totalProcessed}`);
  console.log(`Failed:     ${totalFailed}`);
  console.log(`ASINs:      ${totalAsins}`);
  console.log(`Ratings:    ${totalRatings}`);
  console.log(`Duration:   ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);
  console.log(`ASIN rate:  ${totalProcessed > 0 ? ((totalAsins / totalProcessed) * 100).toFixed(1) : 0}%`);
  console.log(`Rating rate: ${totalProcessed > 0 ? ((totalRatings / totalProcessed) * 100).toFixed(1) : 0}%`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
