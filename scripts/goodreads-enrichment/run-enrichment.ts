/**
 * Step 2: Run Goodreads bulk enrichment via Apify.
 *
 * Reads catalog export files and sends URLs to epctex/goodreads-scraper
 * in batches. Saves raw actor output to JSON files for import.
 *
 * The actor expects: { startUrls: string[], proxy: { useApifyProxy: true } }
 * Each URL can be a direct book page or a search URL.
 *
 * Usage:
 *   npx tsx scripts/goodreads-enrichment/run-enrichment.ts --test        # 1 batch of 25
 *   npx tsx scripts/goodreads-enrichment/run-enrichment.ts --tier 1      # Tier 1 only
 *   npx tsx scripts/goodreads-enrichment/run-enrichment.ts               # all tiers
 *   npx tsx scripts/goodreads-enrichment/run-enrichment.ts --resume      # skip already-scraped
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
if (!APIFY_TOKEN) {
  console.error("APIFY_API_TOKEN is required");
  process.exit(1);
}

const ACTOR_ID = "epctex~goodreads-scraper";
const OUT_DIR = join(__dirname);
const BATCH_SIZE = 25;
const POLL_INTERVAL_MS = 5_000;
const RUN_TIMEOUT_MS = 600_000; // 10 min per run
const BETWEEN_RUNS_DELAY_MS = 2_000;

const TEST_MODE = process.argv.includes("--test");
const RESUME = process.argv.includes("--resume") || !TEST_MODE; // auto-resume in full mode
const TIER_FLAG = process.argv.indexOf("--tier");
const TIER_FILTER = TIER_FLAG >= 0 ? parseInt(process.argv[TIER_FLAG + 1]) : null;

interface CatalogBook {
  id: string;
  title: string;
  author: string;
  tier: 1 | 2 | 3;
  goodreads_id: string | null;
  scrape_url: string;
}

interface GoodreadsResult {
  // Raw actor output fields
  bookId?: number;
  url?: string;
  title?: string;
  authorName?: string;
  rating?: number;
  numberOfRatings?: number;
  numberOfReviews?: number;
  description?: string;
  image?: string;
  numberOfPages?: number;
  ISBN?: string;
  Series?: string;
  firstPublishedDate?: string;
  publishedBy?: string;
  bookFormat?: string;
  buyLinks?: string[];
  // Our metadata
  _catalogBookId?: string;
  _tier?: number;
  _batchIndex?: number;
}

// --- Apify helpers ---

async function startActorRun(startUrls: string[]): Promise<{ runId: string; datasetId: string }> {
  const input = {
    startUrls,
    includeReviews: false,
    maxItems: startUrls.length + 5, // small buffer
    proxy: { useApifyProxy: true },
  };

  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );

  if (!res.ok) {
    throw new Error(`Start failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return { runId: data.data.id, datasetId: data.data.defaultDatasetId };
}

async function waitForRun(runId: string): Promise<{ status: string; costUsd: number }> {
  let elapsed = 0;
  while (true) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    elapsed += POLL_INTERVAL_MS;

    const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    const data = await res.json();
    const status = data.data.status;
    const cost = data.data.usageTotalUsd ?? 0;

    if (elapsed % 30_000 < POLL_INTERVAL_MS) {
      console.log(`    ... ${status} (${Math.round(elapsed / 1000)}s, $${cost.toFixed(4)})`);
    }

    if (status !== "RUNNING" && status !== "READY") {
      return { status, costUsd: cost };
    }

    if (elapsed >= RUN_TIMEOUT_MS) {
      // Abort the run
      await fetch(`https://api.apify.com/v2/actor-runs/${runId}/abort?token=${APIFY_TOKEN}`, {
        method: "POST",
      });
      return { status: "TIMEOUT", costUsd: cost };
    }
  }
}

async function getDatasetItems(datasetId: string): Promise<GoodreadsResult[]> {
  const res = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=1000`
  );
  if (!res.ok) throw new Error(`Dataset fetch failed: ${res.status}`);
  return res.json();
}

// --- Result matching ---

function matchResultsToBooks(
  batchBooks: CatalogBook[],
  results: GoodreadsResult[],
  batchIndex: number
): GoodreadsResult[] {
  // Tag each result with the catalog book it matches
  const tagged: GoodreadsResult[] = [];

  for (const result of results) {
    const resultUrl = result.url ?? "";
    const resultBookId = result.bookId;

    // Try to match by Goodreads ID or URL
    let matchedBook: CatalogBook | undefined;

    // Match by bookId in the result
    if (resultBookId) {
      matchedBook = batchBooks.find(
        (b) => b.goodreads_id === String(resultBookId)
      );
    }

    // Match by URL overlap
    if (!matchedBook && resultUrl) {
      matchedBook = batchBooks.find((b) => {
        // Check if the result URL contains the same Goodreads book ID
        if (b.goodreads_id && resultUrl.includes(`/show/${b.goodreads_id}`)) return true;
        // Or if input URL matches
        if (resultUrl === b.scrape_url) return true;
        return false;
      });
    }

    // For search URLs (Tier 2/3), we can't always match by URL — tag with batch info
    tagged.push({
      ...result,
      _catalogBookId: matchedBook?.id ?? undefined,
      _tier: matchedBook?.tier,
      _batchIndex: batchIndex,
    });
  }

  return tagged;
}

// --- Main ---

async function main() {
  console.log("=== Goodreads Bulk Enrichment ===");
  console.log(`Actor: ${ACTOR_ID}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Mode: ${TEST_MODE ? "TEST (1 batch)" : "FULL"}${TIER_FILTER ? ` — Tier ${TIER_FILTER} only` : ""}\n`);

  // Load catalog
  const catalogPath = join(OUT_DIR, "catalog-all.json");
  if (!existsSync(catalogPath)) {
    console.error("Run export-catalog.ts first!");
    process.exit(1);
  }

  let catalog: CatalogBook[] = JSON.parse(readFileSync(catalogPath, "utf-8"));

  if (TIER_FILTER) {
    catalog = catalog.filter((b) => b.tier === TIER_FILTER);
  }

  console.log(`Catalog: ${catalog.length} books`);

  // Load existing results for resume
  const resultsPath = join(OUT_DIR, "goodreads-results.json");
  let existingResults: GoodreadsResult[] = [];
  const scrapedUrls = new Set<string>();

  if (RESUME && existsSync(resultsPath)) {
    existingResults = JSON.parse(readFileSync(resultsPath, "utf-8"));
    for (const r of existingResults) {
      if (r.url) scrapedUrls.add(r.url);
    }
    // Also track by catalog book ID
    const scrapedBookIds = new Set(
      existingResults.filter((r) => r._catalogBookId).map((r) => r._catalogBookId)
    );
    catalog = catalog.filter((b) => !scrapedBookIds.has(b.id));
    console.log(`Resume: ${existingResults.length} existing results, ${catalog.length} remaining`);
  }

  if (catalog.length === 0) {
    console.log("Nothing to process!");
    return;
  }

  // Process in batches
  const totalBatches = TEST_MODE ? 1 : Math.ceil(catalog.length / BATCH_SIZE);
  const allResults = [...existingResults];
  let totalCostUsd = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;

  for (let i = 0; i < catalog.length; i += BATCH_SIZE) {
    if (TEST_MODE && i > 0) break;

    const batch = catalog.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const urls = batch.map((b) => b.scrape_url);

    console.log(`\nBatch ${batchNum}/${totalBatches}: ${batch.length} books (Tiers: ${[...new Set(batch.map((b) => b.tier))].join(",")})`);

    try {
      const { runId, datasetId } = await startActorRun(urls);
      console.log(`  Run: ${runId}`);

      const { status, costUsd } = await waitForRun(runId);
      totalCostUsd += costUsd;

      if (status === "SUCCEEDED") {
        const items = await getDatasetItems(datasetId);
        const tagged = matchResultsToBooks(batch, items, batchNum);
        allResults.push(...tagged);
        totalSucceeded += items.length;
        console.log(`  ✓ ${items.length} results ($${costUsd.toFixed(4)})`);
      } else {
        totalFailed += batch.length;
        console.warn(`  ✗ Run ${status} ($${costUsd.toFixed(4)})`);
      }
    } catch (err) {
      totalFailed += batch.length;
      console.error(`  ✗ Error: ${err}`);
    }

    // Save progress after each batch
    writeFileSync(resultsPath, JSON.stringify(allResults, null, 2));

    if (i + BATCH_SIZE < catalog.length && !TEST_MODE) {
      await new Promise((r) => setTimeout(r, BETWEEN_RUNS_DELAY_MS));
    }
  }

  // Summary
  console.log("\n=== SUMMARY ===");
  console.log(`Results collected: ${allResults.length}`);
  console.log(`This run: ${totalSucceeded} succeeded, ${totalFailed} failed`);
  console.log(`Total Apify cost: $${totalCostUsd.toFixed(4)}`);

  if (TEST_MODE) {
    const costPerBook = totalSucceeded > 0 ? totalCostUsd / totalSucceeded : 0;
    const fullCatalogSize = JSON.parse(readFileSync(join(OUT_DIR, "catalog-all.json"), "utf-8")).length;
    console.log(`\n--- Cost Projection ---`);
    console.log(`Cost per book:    $${costPerBook.toFixed(4)}`);
    console.log(`Full catalog:     ${fullCatalogSize} books`);
    console.log(`Projected cost:   $${(costPerBook * fullCatalogSize).toFixed(2)}`);
    console.log(`Projected batches: ${Math.ceil(fullCatalogSize / BATCH_SIZE)}`);
  }

  writeFileSync(resultsPath, JSON.stringify(allResults, null, 2));
  console.log(`\nResults saved to ${resultsPath}`);
  console.log("Run import-results.ts next.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
