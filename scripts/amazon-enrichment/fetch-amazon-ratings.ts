/**
 * Step 2: Fetch Amazon ratings via Apify
 *
 * Uses the FREE Apify Actor `junglee~free-amazon-product-scraper` to look up
 * books on Amazon. Input format: `categoryUrls` with Amazon URLs.
 *
 * Strategy:
 *   - Books with ASIN  → /dp/{ASIN} (direct product page)
 *   - Books with ISBN   → /s?k={ISBN} (Amazon search by ISBN)
 *   - Books title-only  → /s?k={title}+{author} (fuzzy search)
 *
 * The free scraper returns structured data: stars, reviewsCount, starsBreakdown, asin.
 *
 * Usage:
 *   npx tsx scripts/amazon-enrichment/fetch-amazon-ratings.ts --test     # 50 books
 *   npx tsx scripts/amazon-enrichment/fetch-amazon-ratings.ts            # full run
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
if (!APIFY_TOKEN) {
  console.error("APIFY_API_TOKEN environment variable is required");
  process.exit(1);
}

const TEST_MODE = process.argv.includes("--test");
const OUT_DIR = join(__dirname);
const BATCH_SIZE = 50; // Direct /dp/ URLs are fast; search URLs would need smaller batches
const POLL_INTERVAL_MS = 5000;
const BETWEEN_RUNS_DELAY_MS = 3000;
const ACTOR_ID = "junglee~free-amazon-product-scraper";

// --- Types ---

interface BookInput {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  amazon_asin: string | null;
}

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

interface UnmatchedBook {
  book_id: string;
  title: string;
  author: string;
  reason: string;
  candidates?: Array<{ title: string; asin: string; rating: number }>;
}

// --- Apify helpers ---

async function startActorRun(input: Record<string, unknown>): Promise<string> {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) throw new Error(`Apify start failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.data.id;
}

async function waitForRun(runId: string): Promise<{ status: string; datasetId: string; usageTotalUsd?: number }> {
  let elapsed = 0;
  while (true) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    elapsed += POLL_INTERVAL_MS;
    const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    const data = await res.json();
    const status = data.data.status;
    if (elapsed % 30000 < POLL_INTERVAL_MS) {
      console.log(`    ... still ${status} (${Math.round(elapsed / 1000)}s)`);
    }
    if (status !== "RUNNING" && status !== "READY") {
      return {
        status,
        datasetId: data.data.defaultDatasetId,
        usageTotalUsd: data.data.usageTotalUsd,
      };
    }
    // Timeout after 5 minutes per run
    if (elapsed > 300_000) {
      return { status: "TIMEOUT", datasetId: data.data.defaultDatasetId, usageTotalUsd: data.data.usageTotalUsd };
    }
  }
}

async function getDatasetItems(datasetId: string): Promise<unknown[]> {
  const res = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=1000`
  );
  if (!res.ok) throw new Error(`Apify dataset fetch failed: ${res.status}`);
  return res.json();
}

// --- Matching helpers ---

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s*[:—–-]\s*.+$/, "") // Strip subtitle
    .replace(/[^\w\s]/g, "")
    .trim();
}

function similarity(a: string, b: string): number {
  const wordsA = new Set(normalizeTitle(a).split(/\s+/));
  const wordsB = new Set(normalizeTitle(b).split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size > 0 ? intersection.length / union.size : 0;
}

function authorLastName(author: string): string {
  const parts = author.trim().split(/\s+/);
  return (parts[parts.length - 1] || "").toLowerCase();
}

// --- URL builders ---

function buildAsinUrl(asin: string): string {
  return `https://www.amazon.com/dp/${asin}`;
}

function buildIsbnUrl(isbn: string): string {
  // ISBN-10s work as direct Amazon product URLs (same as ASINs)
  return `https://www.amazon.com/dp/${isbn}`;
}

function buildTitleSearchUrl(title: string, author: string): string {
  const query = `${title} ${author}`;
  return `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
}

// --- Result parser ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseApifyResult(book: BookInput, item: any, method: "asin" | "isbn" | "title"): AmazonResult | null {
  // Check for error responses (404, captcha, etc.)
  if (item.error) return null;

  const asin = item.asin || item.originalAsin || "";
  const rating = typeof item.stars === "number" ? item.stars : parseFloat(item.stars || "0");
  const reviewCount = typeof item.reviewsCount === "number"
    ? item.reviewsCount
    : parseInt(String(item.reviewsCount || "0").replace(/,/g, ""), 10);

  if (!asin && rating === 0) return null;

  // Confidence scoring
  let confidence: "high" | "medium" | "low";
  const resultTitle = item.title || "";
  const resultAuthor = item.author || "";
  const titleSim = similarity(book.title, resultTitle);
  const authorMatch = authorLastName(book.author) === authorLastName(resultAuthor) ||
    resultAuthor.toLowerCase().includes(authorLastName(book.author));

  if (method === "asin" || method === "isbn") {
    confidence = "high"; // Direct product URL lookup — definitive
  } else {
    // Title search — need confirmation
    if (titleSim > 0.7 && authorMatch) {
      confidence = "high";
    } else if (titleSim > 0.5 && authorMatch) {
      confidence = "medium";
    } else if (titleSim > 0.7) {
      confidence = "medium";
    } else {
      confidence = "low";
    }
  }

  return {
    book_id: book.id,
    title: book.title,
    author: book.author,
    asin,
    amazon_rating: rating,
    amazon_review_count: reviewCount,
    amazon_stars_breakdown: item.starsBreakdown || null,
    match_confidence: confidence,
    match_method: method,
  };
}

// --- Batch processor ---

async function processBatch(
  books: BookInput[],
  method: "asin" | "isbn" | "title"
): Promise<{
  results: AmazonResult[];
  unmatched: UnmatchedBook[];
  costUsd: number;
}> {
  // Build URLs for each book
  const urls = books.map((b) => {
    if (method === "asin") return buildAsinUrl(b.amazon_asin!);
    if (method === "isbn") return buildIsbnUrl(b.isbn!);
    return buildTitleSearchUrl(b.title, b.author);
  });

  const categoryUrls = urls.map((url) => ({ url }));

  console.log(`  Starting ${method} lookup for ${books.length} books...`);

  const runId = await startActorRun({
    categoryUrls,
    maxResults: method === "asin" ? 1 : 3,
  });

  const { status, datasetId, usageTotalUsd } = await waitForRun(runId);
  if (status !== "SUCCEEDED") {
    console.warn(`  Run ${status} — retrying individual failures later`);
    return {
      results: [],
      unmatched: books.map((b) => ({
        book_id: b.id, title: b.title, author: b.author, reason: `Actor run ${status}`,
      })),
      costUsd: usageTotalUsd ?? 0,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = await getDatasetItems(datasetId) as any[];

  const results: AmazonResult[] = [];
  const unmatched: UnmatchedBook[] = [];

  if (method === "asin" || method === "isbn") {
    // Direct product URL lookups — each URL maps to one result
    const inputToItem = new Map<string, unknown>();
    for (const item of items) {
      const key = item.input || item.url || "";
      inputToItem.set(key, item);
    }

    for (let i = 0; i < books.length; i++) {
      const book = books[i];
      const url = urls[i];
      const identifier = method === "asin" ? book.amazon_asin : book.isbn;

      // Try matching by input URL, or by ASIN/ISBN in the result
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let item = inputToItem.get(url) as any;
      if (!item) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        item = items.find((it: any) => (it.asin || it.originalAsin) === identifier);
      }

      if (item) {
        const parsed = parseApifyResult(book, item, method);
        if (parsed) {
          results.push(parsed);
          continue;
        }
      }
      unmatched.push({
        book_id: book.id, title: book.title, author: book.author,
        reason: item?.error || `No result for ${method.toUpperCase()}`,
      });
    }
  } else {
    // For search results, items come back in order of the input URLs
    // The free scraper returns one item per input URL (the top search result)
    // Group by input URL
    const itemsByInput = new Map<string, unknown[]>();
    for (const item of items) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const key = (item as any).input || (item as any).url || "";
      const existing = itemsByInput.get(key) ?? [];
      existing.push(item);
      itemsByInput.set(key, existing);
    }

    for (let i = 0; i < books.length; i++) {
      const book = books[i];
      const url = urls[i];

      // Get results for this book's search URL
      const bookItems = itemsByInput.get(url) ?? [];

      // Also try broader matching if no direct URL match
      const candidates = bookItems.length > 0 ? bookItems : items.filter((it) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t = (it as any).title || "";
        return similarity(book.title, t) > 0.3;
      });

      let bestResult: AmazonResult | null = null;
      for (const candidate of candidates) {
        const parsed = parseApifyResult(book, candidate, method);
        if (parsed && (parsed.match_confidence === "high" || parsed.match_confidence === "medium")) {
          if (!bestResult || parsed.match_confidence === "high") {
            bestResult = parsed;
            if (parsed.match_confidence === "high") break;
          }
        }
      }

      if (bestResult) {
        results.push(bestResult);
      } else {
        unmatched.push({
          book_id: book.id, title: book.title, author: book.author,
          reason: `No confident match from ${candidates.length} candidates`,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          candidates: (candidates as any[]).slice(0, 3).map((c) => ({
            title: c.title || "?", asin: c.asin || "?",
            rating: typeof c.stars === "number" ? c.stars : 0,
          })),
        });
      }
    }
  }

  return { results, unmatched, costUsd: usageTotalUsd ?? 0 };
}

// --- Main ---

async function main() {
  console.log(`=== Amazon Enrichment: Fetch Ratings via Apify ===`);
  console.log(`Actor: ${ACTOR_ID} (FREE)`);
  console.log(`Mode: ${TEST_MODE ? "TEST (50 books)" : "FULL RUN"}\n`);

  // Load book files
  const loadFile = (name: string): BookInput[] => {
    const path = join(OUT_DIR, name);
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf-8"));
  };

  let booksWithAsin = loadFile("books-with-asin.json");
  let booksWithIsbn = loadFile("books-with-isbn.json");
  let booksTitleOnly = loadFile("books-title-only.json");

  console.log(`Loaded: ${booksWithAsin.length} ASIN, ${booksWithIsbn.length} ISBN, ${booksTitleOnly.length} title-only`);

  // In test mode, take a sample from each category
  if (TEST_MODE) {
    booksWithAsin = booksWithAsin.slice(0, 10);
    booksWithIsbn = booksWithIsbn.slice(0, 20);
    booksTitleOnly = booksTitleOnly.slice(0, 20);
    console.log(`Test sample: ${booksWithAsin.length} ASIN, ${booksWithIsbn.length} ISBN, ${booksTitleOnly.length} title-only`);
  }

  const allResults: AmazonResult[] = [];
  const allUnmatched: UnmatchedBook[] = [];
  let totalCostUsd = 0;

  // Resume support: load existing results if present
  const resultsPath = join(OUT_DIR, "amazon-results.json");
  if (existsSync(resultsPath) && !TEST_MODE) {
    const existing: AmazonResult[] = JSON.parse(readFileSync(resultsPath, "utf-8"));
    const existingIds = new Set(existing.map((r) => r.book_id));
    allResults.push(...existing);
    console.log(`Resuming: ${existing.length} existing results loaded`);

    booksWithAsin = booksWithAsin.filter((b) => !existingIds.has(b.id));
    booksWithIsbn = booksWithIsbn.filter((b) => !existingIds.has(b.id));
    booksTitleOnly = booksTitleOnly.filter((b) => !existingIds.has(b.id));
    console.log(`Remaining: ${booksWithAsin.length} ASIN, ${booksWithIsbn.length} ISBN, ${booksTitleOnly.length} title-only`);
  }

  // Process each category
  // Skip title-only books — too expensive via Apify search ($0.14/book, frequent timeouts).
  // Those stay with the Serper enrichment queue for ASIN capture.
  if (booksTitleOnly.length > 0) {
    console.log(`\nSkipping ${booksTitleOnly.length} title-only books (use Serper enrichment queue instead)`);
  }

  const categories: Array<{ books: BookInput[]; method: "asin" | "isbn" | "title"; label: string }> = [
    { books: booksWithAsin, method: "asin", label: "ASIN lookups" },
    { books: booksWithIsbn, method: "isbn", label: "ISBN direct lookups" },
  ];

  for (const { books, method, label } of categories) {
    if (books.length === 0) continue;

    console.log(`\n--- Processing ${books.length} ${label} ---`);
    for (let i = 0; i < books.length; i += BATCH_SIZE) {
      const batch = books.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(books.length / BATCH_SIZE);
      console.log(`Batch ${batchNum}/${totalBatches}: ${batch.length} books`);

      try {
        const { results, unmatched, costUsd } = await processBatch(batch, method);
        allResults.push(...results);
        allUnmatched.push(...unmatched);
        totalCostUsd += costUsd;
        console.log(`  → ${results.length} matched, ${unmatched.length} unmatched ($${costUsd.toFixed(4)})`);
      } catch (err) {
        console.error(`  → Batch failed: ${err}`);
        allUnmatched.push(...batch.map((b) => ({
          book_id: b.id, title: b.title, author: b.author, reason: `Batch error: ${err}`,
        })));
      }

      saveProgress(allResults, allUnmatched);

      if (i + BATCH_SIZE < books.length) {
        await new Promise((r) => setTimeout(r, BETWEEN_RUNS_DELAY_MS));
      }
    }
  }

  // Final summary
  console.log("\n=== SUMMARY ===");
  console.log(`Total matched:    ${allResults.length}`);
  console.log(`  High confidence:  ${allResults.filter((r) => r.match_confidence === "high").length}`);
  console.log(`  Medium confidence: ${allResults.filter((r) => r.match_confidence === "medium").length}`);
  console.log(`  Low confidence:    ${allResults.filter((r) => r.match_confidence === "low").length}`);
  console.log(`Total unmatched:  ${allUnmatched.length}`);
  console.log(`Total Apify cost: $${totalCostUsd.toFixed(4)}`);

  if (TEST_MODE) {
    const totalBooks = booksWithAsin.length + booksWithIsbn.length + booksTitleOnly.length;
    const fullTotal = loadFile("books-to-enrich.json").length;
    const projectedCost = totalBooks > 0 ? (totalCostUsd / totalBooks) * fullTotal : 0;
    const successRate = (allResults.length / Math.max(totalBooks, 1)) * 100;
    console.log(`\n--- Cost Estimate for Full Run ---`);
    console.log(`Test books processed: ${totalBooks}`);
    console.log(`Full catalog size:    ${fullTotal}`);
    console.log(`Projected total cost: $${projectedCost.toFixed(2)}`);
    console.log(`Success rate:         ${successRate.toFixed(1)}%`);
    console.log(`Projected matches:    ~${Math.round(fullTotal * successRate / 100)} books`);
  }

  saveProgress(allResults, allUnmatched);
  console.log("\nDone! Run import-amazon-ratings.ts next.");
}

function saveProgress(results: AmazonResult[], unmatched: UnmatchedBook[]) {
  writeFileSync(join(OUT_DIR, "amazon-results.json"), JSON.stringify(results, null, 2));
  writeFileSync(join(OUT_DIR, "unmatched-books.json"), JSON.stringify(unmatched, null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
