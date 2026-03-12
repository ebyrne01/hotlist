/**
 * BACKFILL REVIEW CLASSIFIER SPICE SIGNALS
 *
 * Fetches reviews from Goodreads (and Amazon snippets) for books that have
 * a goodreads_url but no review_classifier signal in spice_signals.
 * Prioritizes books that lack romance_io signals (they need this most).
 *
 * Processes in batches of 5 with 2-second delays (gentle on Goodreads).
 *
 * Usage: npx tsx scripts/backfill-review-spice.ts
 *        npx tsx scripts/backfill-review-spice.ts --limit 50
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { classifyReviews } from "../lib/spice/review-classifier";
import { fetchAllReviews } from "../lib/spice/review-fetcher";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 2000;

async function main() {
  const supabase = getAdminClient();

  // Parse --limit flag
  const limitFlagIndex = process.argv.indexOf("--limit");
  const limit =
    limitFlagIndex !== -1 && process.argv[limitFlagIndex + 1]
      ? Number(process.argv[limitFlagIndex + 1])
      : 100;

  console.log(`Review classifier backfill — limit: ${limit}`);

  // Get books that already have a review_classifier signal (skip)
  const { data: existingRows } = await supabase
    .from("spice_signals")
    .select("book_id")
    .eq("source", "review_classifier");
  const existingIds = new Set((existingRows ?? []).map((r) => r.book_id));
  console.log(`Books with existing review_classifier: ${existingIds.size} (skip)`);

  // Get books that have romance_io signals (lower priority)
  const { data: romanceIoRows } = await supabase
    .from("spice_signals")
    .select("book_id")
    .eq("source", "romance_io");
  const hasRomanceIo = new Set((romanceIoRows ?? []).map((r) => r.book_id));

  // Fetch candidate books: have goodreads_url
  const { data: candidates, error } = await supabase
    .from("books")
    .select("id, title, author, goodreads_url, amazon_asin")
    .not("goodreads_url", "is", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching books:", error.message);
    return;
  }

  if (!candidates || candidates.length === 0) {
    console.log("No candidate books found.");
    return;
  }

  // Filter and prioritize
  const eligible = candidates.filter(
    (b) => b.goodreads_url && !existingIds.has(b.id)
  );

  // Sort: books WITHOUT romance_io first (they need this most)
  eligible.sort((a, b) => {
    const aHas = hasRomanceIo.has(a.id) ? 1 : 0;
    const bHas = hasRomanceIo.has(b.id) ? 1 : 0;
    return aHas - bHas;
  });

  const toProcess = eligible.slice(0, limit);
  console.log(
    `Eligible: ${eligible.length}, processing: ${toProcess.length}`
  );
  console.log(
    `  Without romance_io (high priority): ${toProcess.filter((b) => !hasRomanceIo.has(b.id)).length}`
  );
  console.log(
    `  With romance_io (corroboration): ${toProcess.filter((b) => hasRomanceIo.has(b.id)).length}\n`
  );

  let processed = 0;
  let keywordClassified = 0;
  let llmClassified = 0;
  let noSignal = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);

    for (const book of batch) {
      processed++;
      try {
        const reviews = await fetchAllReviews({
          goodreadsUrl: book.goodreads_url,
          title: book.title,
          author: book.author,
          amazonAsin: book.amazon_asin,
        });

        if (reviews.length < 2) {
          noSignal++;
          continue;
        }

        const result = await classifyReviews(
          reviews,
          book.title,
          book.author
        );

        if (!result) {
          noSignal++;
          continue;
        }

        const { error: upsertError } = await supabase
          .from("spice_signals")
          .upsert(
            {
              book_id: book.id,
              source: "review_classifier",
              spice_value: result.spice,
              confidence: result.confidence,
              evidence: {
                method: result.method,
                reviews_analyzed: result.reviewsAnalyzed,
                keyword_hits: result.keywordHits,
                per_review_scores: result.perReviewScores,
                reasoning: result.reasoning ?? null,
                source_platform: "goodreads+amazon",
                classified_at: new Date().toISOString(),
              },
              updated_at: new Date().toISOString(),
            },
            { onConflict: "book_id,source" }
          );

        if (upsertError) {
          console.error(
            `  Upsert error for "${book.title}":`,
            upsertError.message
          );
          failed++;
        } else {
          if (result.method === "keyword") keywordClassified++;
          else llmClassified++;

          if (processed % 10 === 0) {
            console.log(
              `  ... ${processed}/${toProcess.length} (keyword: ${keywordClassified}, llm: ${llmClassified})`
            );
          }
        }
      } catch (err) {
        console.error(
          `  Error for "${book.title}":`,
          err instanceof Error ? err.message : err
        );
        failed++;
      }
    }

    // Delay between batches
    if (i + BATCH_SIZE < toProcess.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log(`\nDone!`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Keyword-classified: ${keywordClassified}`);
  console.log(`  LLM-classified: ${llmClassified}`);
  console.log(`  No signal (too few reviews/hits): ${noSignal}`);
  console.log(`  Failed: ${failed}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
