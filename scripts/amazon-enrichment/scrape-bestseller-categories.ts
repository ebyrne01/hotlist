/**
 * Scrape Amazon bestseller category pages via Apify and import into Supabase.
 *
 * Uses the `junglee/amazon-bestsellers` Apify actor to scrape JS-rendered
 * bestseller pages, then matches results against our DB — upserting ratings
 * for existing books and creating provisional records for new ones.
 *
 * Usage:
 *   npx tsx scripts/amazon-enrichment/scrape-bestseller-categories.ts --test     # 1 category
 *   npx tsx scripts/amazon-enrichment/scrape-bestseller-categories.ts --dry-run  # scrape but don't write DB
 *   npx tsx scripts/amazon-enrichment/scrape-bestseller-categories.ts            # full run (all categories)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "fs";
import { join } from "path";
import { getAdminClient } from "@/lib/supabase/admin";
import { queueEnrichmentJobs } from "@/lib/enrichment/queue";
import { searchGoogleBooks } from "@/lib/books/google-books";

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
if (!APIFY_TOKEN) {
  console.error("APIFY_API_TOKEN environment variable is required");
  process.exit(1);
}

const TEST_MODE = process.argv.includes("--test");
const DRY_RUN = process.argv.includes("--dry-run");
const ACTOR_ID = "junglee~amazon-bestsellers";
const POLL_INTERVAL_MS = 10_000;
const MAX_WAIT_MS = 600_000; // 10 minutes per run

// --- Amazon Bestseller Category URLs ---

const CATEGORY_URLS = [
  { url: "https://www.amazon.com/Best-Sellers-Books-Romance/zgbs/books/23/", label: "Romance" },
  { url: "https://www.amazon.com/Best-Sellers-Books-Alpha-Male-Romance/zgbs/books/120214351011/", label: "Alpha Male" },
  { url: "https://www.amazon.com/Best-Sellers-Books-Billionaires-Millionaires-Romance/zgbs/books/120214349011/", label: "Billionaires" },
  { url: "https://www.amazon.com/Best-Sellers-Books-Dark-Romance/zgbs/books/211759001011/", label: "Dark Romance" },
  { url: "https://www.amazon.com/Best-Sellers-Books-Enemies-to-Lovers-Romance/zgbs/books/120214344011/", label: "Enemies to Lovers" },
  { url: "https://www.amazon.com/Best-Sellers-Books-Erotic-Literature-Fiction/zgbs/books/10141/", label: "Erotic Literature" },
  { url: "https://www.amazon.com/Best-Sellers-Books-Fake-Dating-Romance/zgbs/books/211758999011/", label: "Fake Dating" },
  { url: "https://www.amazon.com/Best-Sellers-Books-Friends-to-Lovers-Romance/zgbs/books/211759000011/", label: "Friends to Lovers" },
  { url: "https://www.amazon.com/Best-Sellers-Books-Historical-Romances/zgbs/books/13371/", label: "Historical Romance" },
  { url: "https://www.amazon.com/Best-Sellers-Books-Gothic-Romances/zgbs/books/276240011/", label: "Gothic Romance" },
  { url: "https://www.amazon.com/Best-Sellers-Books-Paranormal-Romance/zgbs/books/13356/", label: "Paranormal Romance" },
  { url: "https://www.amazon.com/Best-Sellers-Books-Vampire-Romances/zgbs/books/16399311/", label: "Vampire Romance" },
  { url: "https://www.amazon.com/Best-Sellers-Books-Romantasy/zgbs/books/7654406011/", label: "Romantasy" },
  { url: "https://www.amazon.com/Best-Sellers-Books-Sports-Romance/zgbs/books/10387327011/", label: "Sports Romance" },
  { url: "https://www.amazon.com/Best-Sellers-Books-Werewolf-Shifter-Romance/zgbs/books/13922582011/", label: "Werewolf & Shifter" },
];

// --- Types ---

interface BestsellerItem {
  title?: string;
  name?: string;
  asin?: string;
  stars?: number | string;
  rating?: number | string;
  reviewsCount?: number | string;
  numberOfReviews?: number | string;
  rank?: number;
  price?: string;
  url?: string;
  thumbnail?: string;
  category?: string;
  categoryUrl?: string;
  author?: string;
}

interface ImportResult {
  category: string;
  title: string;
  author: string;
  asin: string;
  rating: number;
  reviewCount: number;
  rank: number;
  action: "matched" | "created" | "skipped";
  bookId?: string;
}

// --- Apify helpers (adapted from fetch-amazon-ratings.ts) ---

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

async function waitForRun(runId: string): Promise<{ status: string; datasetId: string; costUsd: number }> {
  let elapsed = 0;
  while (true) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    elapsed += POLL_INTERVAL_MS;
    const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    const data = await res.json();
    const status = data.data.status;
    if (elapsed % 30000 < POLL_INTERVAL_MS) {
      console.log(`    ... ${status} (${Math.round(elapsed / 1000)}s)`);
    }
    if (status !== "RUNNING" && status !== "READY") {
      return {
        status,
        datasetId: data.data.defaultDatasetId,
        costUsd: data.data.usageTotalUsd ?? 0,
      };
    }
    if (elapsed > MAX_WAIT_MS) {
      return { status: "TIMEOUT", datasetId: data.data.defaultDatasetId, costUsd: data.data.usageTotalUsd ?? 0 };
    }
  }
}

async function getDatasetItems(datasetId: string): Promise<BestsellerItem[]> {
  const res = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=2000`
  );
  if (!res.ok) throw new Error(`Dataset fetch failed: ${res.status}`);
  return res.json();
}

// --- Parsing helpers ---

function parseTitle(item: BestsellerItem): string {
  const raw = item.title || item.name || "";
  // Amazon bestseller titles often include series info, strip it for matching
  // e.g. "A Court of Thorns and Roses (A Court of Thorns and Roses, 1)"
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function parseAuthor(item: BestsellerItem): string {
  // Author might be in the item directly, or embedded in the title
  if (item.author) return item.author.trim();
  // Some actors put author in the title after " by "
  const raw = item.title || item.name || "";
  const byMatch = raw.match(/\sby\s+(.+)$/i);
  return byMatch ? byMatch[1].trim() : "";
}

function parseRating(item: BestsellerItem): number {
  const raw = item.stars ?? item.rating ?? 0;
  const num = typeof raw === "number" ? raw : parseFloat(raw);
  return isNaN(num) ? 0 : num;
}

function parseReviewCount(item: BestsellerItem): number {
  const raw = item.reviewsCount ?? item.numberOfReviews ?? 0;
  if (typeof raw === "number") return raw;
  return parseInt(String(raw).replace(/,/g, ""), 10) || 0;
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

// --- Google Books author lookup ---

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(normalizeForMatch(a).split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(normalizeForMatch(b).split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  // Jaccard similarity
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.length / union.size;
}

async function lookupAuthorViaGoogleBooks(
  title: string
): Promise<{ author: string; isbn13: string | null } | null> {
  try {
    const results = await searchGoogleBooks(title);
    if (results.length === 0) return null;

    // Find a result with high title similarity (>= 0.5 word overlap)
    const candidates = results
      .map(r => ({ ...r, overlap: wordOverlap(title, r.title) }))
      .filter(r => r.overlap >= 0.5 && r.author && r.author !== "Unknown Author")
      .sort((a, b) => b.overlap - a.overlap);

    if (candidates.length === 0) return null;

    const best = candidates[0];
    return { author: best.author, isbn13: best.isbn13 ?? null };
  } catch {
    return null;
  }
}

// --- DB matching ---

async function findBookInDb(
  supabase: ReturnType<typeof getAdminClient>,
  title: string,
  author: string,
  asin: string
): Promise<{ id: string; isbn13: string | null; series_name: string | null } | null> {
  // 1. Try ASIN match first (most reliable)
  if (asin) {
    const { data } = await supabase
      .from("books")
      .select("id, isbn13, series_name")
      .eq("amazon_asin", asin)
      .limit(1)
      .single();
    if (data) return data;
  }

  // 2. Try exact title match
  const { data: titleMatch } = await supabase
    .from("books")
    .select("id, isbn13, series_name")
    .ilike("title", title)
    .limit(1)
    .single();
  if (titleMatch) return titleMatch;

  // 3. Try normalized title match (strip subtitle after colon/dash)
  const shortTitle = title.replace(/[:—–-]\s*.+$/, "").trim();
  if (shortTitle !== title && shortTitle.length > 5) {
    const { data: shortMatch } = await supabase
      .from("books")
      .select("id, isbn13, series_name")
      .ilike("title", shortTitle)
      .limit(1)
      .single();
    if (shortMatch) return shortMatch;
  }

  return null;
}

// --- Main ---

async function main() {
  const categories = TEST_MODE ? CATEGORY_URLS.slice(0, 1) : CATEGORY_URLS;

  console.log(`=== Amazon Bestseller Scraper${TEST_MODE ? " (TEST — 1 category)" : ""}${DRY_RUN ? " (DRY RUN)" : ""} ===`);
  console.log(`Actor: ${ACTOR_ID}`);
  console.log(`Categories: ${categories.length}\n`);

  const supabase = getAdminClient();
  const allResults: ImportResult[] = [];
  let totalCostUsd = 0;
  let totalMatched = 0;
  let totalCreated = 0;
  let totalSkipped = 0;
  let totalRatingsUpserted = 0;
  let totalAsinsSet = 0;
  const seenAsins = new Set<string>();

  for (const category of categories) {
    console.log(`\n--- ${category.label} ---`);
    console.log(`  URL: ${category.url}`);

    try {
      // Start the Apify run for this category
      const runId = await startActorRun({
        categoryUrls: [category.url],
        maxItemsPerStartUrl: 100,
        depthOfCrawl: 1,
      });
      console.log(`  Run started: ${runId}`);

      const { status, datasetId, costUsd } = await waitForRun(runId);
      totalCostUsd += costUsd;

      if (status !== "SUCCEEDED") {
        console.warn(`  Run ${status} — skipping this category`);
        continue;
      }

      const items = await getDatasetItems(datasetId);
      console.log(`  Got ${items.length} items ($${costUsd.toFixed(4)})`);

      // Process each bestseller item
      for (const item of items) {
        const title = parseTitle(item);
        const author = parseAuthor(item);
        const asin = item.asin || "";
        const rating = parseRating(item);
        const reviewCount = parseReviewCount(item);
        const rank = item.rank ?? 0;

        if (!title || title.length < 2) {
          totalSkipped++;
          continue;
        }

        // Deduplicate across categories (same ASIN appears in multiple lists)
        if (asin && seenAsins.has(asin)) {
          continue; // Already processed this book from another category
        }
        if (asin) seenAsins.add(asin);

        // Try to find in DB
        const existing = await findBookInDb(supabase, title, author, asin);

        if (existing) {
          totalMatched++;

          if (!DRY_RUN) {
            // Upsert Amazon rating
            if (rating > 0) {
              await supabase.from("book_ratings").upsert(
                {
                  book_id: existing.id,
                  source: "amazon",
                  rating,
                  rating_count: reviewCount || null,
                  scraped_at: new Date().toISOString(),
                },
                { onConflict: "book_id,source" }
              );
              totalRatingsUpserted++;
            }

            // Set ASIN if we have one and the book doesn't
            if (asin) {
              await supabase
                .from("books")
                .update({ amazon_asin: asin })
                .eq("id", existing.id)
                .is("amazon_asin", null);
              totalAsinsSet++;
            }
          }

          allResults.push({ category: category.label, title, author, asin, rating, reviewCount, rank, action: "matched", bookId: existing.id });
          console.log(`    ✓ ${title}${rating ? ` → ${rating}★` : ""}`);
        } else {
          // Look up author via Google Books before creating
          let resolvedAuthor = author;
          let resolvedIsbn: string | null = null;
          if (!resolvedAuthor) {
            const gbResult = await lookupAuthorViaGoogleBooks(title);
            if (gbResult) {
              resolvedAuthor = gbResult.author;
              resolvedIsbn = gbResult.isbn13;
            }
          }

          if (!resolvedAuthor) {
            // Skip books where we can't identify the author — enrichment won't work well
            totalSkipped++;
            allResults.push({ category: category.label, title, author: "?", asin, rating, reviewCount, rank, action: "skipped" });
            console.log(`    ⊘ SKIP (no author): ${title}`);
            continue;
          }

          // Create new provisional book
          if (!DRY_RUN) {
            const slug = title
              .toLowerCase()
              .replace(/[^a-z0-9\s-]/g, "")
              .replace(/\s+/g, "-")
              .slice(0, 80);

            const { data: newBook, error } = await supabase
              .from("books")
              .insert({
                title,
                author: resolvedAuthor,
                amazon_asin: asin || null,
                isbn13: resolvedIsbn,
                slug,
                enrichment_status: "pending",
              })
              .select("id")
              .single();

            if (newBook) {
              totalCreated++;

              // Upsert Amazon rating
              if (rating > 0) {
                await supabase.from("book_ratings").upsert(
                  {
                    book_id: newBook.id,
                    source: "amazon",
                    rating,
                    rating_count: reviewCount || null,
                    scraped_at: new Date().toISOString(),
                  },
                  { onConflict: "book_id,source" }
                );
                totalRatingsUpserted++;
              }

              // Queue enrichment
              await queueEnrichmentJobs(newBook.id, title, resolvedAuthor);

              allResults.push({ category: category.label, title, author: resolvedAuthor, asin, rating, reviewCount, rank, action: "created", bookId: newBook.id });
              console.log(`    + NEW: ${title} by ${resolvedAuthor} (via Google Books)`);
            } else {
              // Likely a slug conflict — book may already exist with different title casing
              totalSkipped++;
              console.log(`    ✗ ${title} — ${error?.message}`);
            }
          } else {
            totalCreated++;
            allResults.push({ category: category.label, title, author: resolvedAuthor, asin, rating, reviewCount, rank, action: "created" });
            console.log(`    ? NEW: ${title} by ${resolvedAuthor || "?"} (would look up via Google Books)`);
          }
        }
      }
    } catch (err) {
      console.error(`  Error on ${category.label}: ${err}`);
    }

    // Small delay between categories to be nice to Apify
    if (categories.indexOf(category) < categories.length - 1) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // Save results to file
  const outPath = join(__dirname, "bestseller-scrape-results.json");
  writeFileSync(outPath, JSON.stringify(allResults, null, 2));

  console.log("\n=== SUMMARY ===");
  console.log(`Categories scraped: ${categories.length}`);
  console.log(`Unique books found: ${allResults.length}`);
  console.log(`  Matched in DB:    ${totalMatched}`);
  console.log(`  New books created: ${totalCreated}`);
  console.log(`  Skipped/errors:   ${totalSkipped}`);
  console.log(`Ratings upserted:   ${totalRatingsUpserted}`);
  console.log(`ASINs set:          ${totalAsinsSet}`);
  console.log(`Total Apify cost:   $${totalCostUsd.toFixed(4)}`);
  console.log(`Results saved to:   ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
