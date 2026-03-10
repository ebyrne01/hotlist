/**
 * COMPREHENSIVE BOOK SEEDER
 *
 * Populates the Hotlist database with 2,000+ high-quality romance/romantasy books
 * from three sources:
 *
 * 1. Goodreads Lists — curated romance lists (most important)
 * 2. NYT Romance Bestsellers Archive — last 24 months of bestsellers
 * 3. Popular author catalogs — top books from 20+ romance authors
 *
 * Usage: npm run seed:books
 *        npx tsx scripts/seed-books.ts
 *
 * Requirements:
 * - .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * - Optional: NYT_BOOKS_API_KEY for Source 2
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import * as cheerio from "cheerio";
import {
  searchGoodreads,
  getGoodreadsBookById,
  extractGoodreadsId,
  isRomanceBook as isRomanceByGenres,
} from "../lib/books/goodreads-search";
import { saveGoodreadsBookToCache } from "../lib/books/cache";
import { isJunkTitle } from "../lib/books/romance-filter";

// ── Config ──────────────────────────────────────────

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 3000;
const USER_AGENT =
  "Hotlist/1.0 (myhotlist.app; book aggregator for romance readers)";

// Counters
const stats = {
  goodreadsLists: { attempted: 0, saved: 0, skipped: 0, errors: 0 },
  nytArchive: { attempted: 0, saved: 0, skipped: 0, errors: 0 },
  authorCatalogs: { attempted: 0, saved: 0, skipped: 0, errors: 0 },
};

// Track all saved Goodreads IDs to avoid re-processing
const processedGoodreadsIds = new Set<string>();

// ── Helpers ─────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
    if (!res.ok) {
      console.warn(`  [fetch] HTTP ${res.status} for ${url}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn(`  [fetch] Failed: ${url}`, err);
    return null;
  }
}

/**
 * Process a single Goodreads book ID: fetch detail, validate, save to cache.
 * Returns true if the book was saved successfully.
 */
async function processGoodreadsBook(
  goodreadsId: string,
  source: keyof typeof stats
): Promise<boolean> {
  if (processedGoodreadsIds.has(goodreadsId)) {
    stats[source].skipped++;
    return false;
  }
  processedGoodreadsIds.add(goodreadsId);
  stats[source].attempted++;

  try {
    const detail = await getGoodreadsBookById(goodreadsId);
    if (!detail) {
      stats[source].errors++;
      return false;
    }

    if (isJunkTitle(detail.title)) {
      stats[source].skipped++;
      return false;
    }

    if (!detail.author || detail.author === "Unknown Author") {
      stats[source].skipped++;
      return false;
    }

    const saved = await saveGoodreadsBookToCache({
      title: detail.title,
      author: detail.author,
      goodreadsId: detail.goodreadsId,
      goodreadsUrl: detail.goodreadsUrl,
      coverUrl: detail.coverUrl,
      description: detail.description,
      seriesName: detail.seriesName,
      seriesPosition: detail.seriesPosition,
      publishedYear: detail.publishedYear,
      pageCount: detail.pageCount,
      genres: detail.genres,
    });

    if (saved) {
      stats[source].saved++;
      console.log(`  ✓ ${detail.title} — ${detail.author}`);
      return true;
    } else {
      stats[source].errors++;
      return false;
    }
  } catch (err) {
    stats[source].errors++;
    console.warn(`  ✗ Error processing ${goodreadsId}:`, err);
    return false;
  }
}

/**
 * Process an array of Goodreads IDs in batches.
 */
async function processBatch(
  goodreadsIds: string[],
  source: keyof typeof stats,
  label: string
) {
  console.log(`\n  Processing ${goodreadsIds.length} books from ${label}...`);
  let batchCount = 0;

  for (let i = 0; i < goodreadsIds.length; i++) {
    await processGoodreadsBook(goodreadsIds[i], source);
    batchCount++;

    if (batchCount >= BATCH_SIZE) {
      console.log(`  ... pausing (${i + 1}/${goodreadsIds.length} done)`);
      await sleep(BATCH_DELAY_MS);
      batchCount = 0;
    }
  }
}

// ── SOURCE 1: Goodreads Lists ───────────────────────

const GOODREADS_LISTS = [
  { url: "https://www.goodreads.com/list/show/12362.Best_Romance_of_the_Decade_2010s", name: "Best Romance 2010s" },
  { url: "https://www.goodreads.com/list/show/117327.Best_Romance_Books_of_2020", name: "Best Romance 2020" },
  { url: "https://www.goodreads.com/list/show/152101.Best_Romance_Books_of_2021", name: "Best Romance 2021" },
  { url: "https://www.goodreads.com/list/show/171771.Best_Romance_Books_of_2022", name: "Best Romance 2022" },
  { url: "https://www.goodreads.com/list/show/185027.Best_Romance_Books_of_2023", name: "Best Romance 2023" },
  { url: "https://www.goodreads.com/list/show/200609.Best_Romance_Books_of_2024", name: "Best Romance 2024" },
  { url: "https://www.goodreads.com/list/show/20.Best_Paranormal_Romance_Series", name: "Best Paranormal Romance" },
  { url: "https://www.goodreads.com/list/show/13358.Best_Romantic_Fantasy", name: "Best Romantic Fantasy" },
];

/**
 * Scrape a Goodreads list page for book IDs.
 * Handles pagination up to 5 pages.
 */
async function scrapeGoodreadsList(listUrl: string): Promise<string[]> {
  const goodreadsIds: string[] = [];
  const maxPages = 5;

  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? listUrl : `${listUrl}?page=${page}`;
    await sleep(1500);

    const html = await fetchHtml(url);
    if (!html) break;

    const $ = cheerio.load(html);
    let foundOnPage = 0;

    // Goodreads list pages have book links in various formats
    $('a[href*="/book/show/"]').each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const id = extractGoodreadsId(href);
      if (id && !goodreadsIds.includes(id)) {
        goodreadsIds.push(id);
        foundOnPage++;
      }
    });

    if (foundOnPage === 0) break; // No more pages
    console.log(`    Page ${page}: found ${foundOnPage} books`);
  }

  return goodreadsIds;
}

async function seedFromGoodreadsLists() {
  console.log("\n━━━ SOURCE 1: Goodreads Lists ━━━");

  for (const list of GOODREADS_LISTS) {
    console.log(`\n📚 Scraping: ${list.name}`);
    console.log(`   ${list.url}`);

    const ids = await scrapeGoodreadsList(list.url);
    console.log(`   Found ${ids.length} unique book IDs`);

    if (ids.length > 0) {
      await processBatch(ids, "goodreadsLists", list.name);
    }

    // Pause between lists
    await sleep(3000);
  }
}

// ── SOURCE 2: NYT Bestsellers Archive ───────────────

const NYT_LISTS = [
  "hardcover-fiction",
  "mass-market-paperback",
  "trade-fiction-paperback",
];

// Romance author keywords for filtering NYT results
const ROMANCE_KEYWORDS = [
  "romance", "love", "heart", "desire", "passion",
  "kiss", "duke", "highlander", "bride", "wedding",
  "cowboy", "billionaire", "prince", "fae", "dragon",
  "mate", "wolf", "vampire", "witch",
];

const KNOWN_ROMANCE_AUTHORS_LOWER = new Set([
  "emily henry", "colleen hoover", "ali hazelwood", "sarah j. maas",
  "rebecca yarros", "jennifer l. armentrout", "penelope douglas",
  "lucy score", "helena hunting", "tessa bailey", "kennedy ryan",
  "kerri maniscalco", "callie hart", "lauren roberts", "caroline peckham",
  "helen hoang", "elena arkas", "diana gabaldon", "nora roberts",
  "nicholas sparks", "cassandra clare", "holly black", "abby jimenez",
  "lynn painter", "elsie silver", "hannah grace", "ana huang",
  "jane austen", "talia hibbert", "jasmine guillory", "christina lauren",
  "kresley cole", "lisa kleypas", "julie garwood", "kristen ashley",
  "mariana zapata", "l.j. shen", "elle kennedy", "susan elizabeth phillips",
  "julia quinn", "johanna lindsey", "jayne ann krentz", "stephanie laurens",
  "lynsay sands", "karen marie moning", "nalini singh", "ilona andrews",
  "sherrilyn kenyon", "jude deveraux", "sandra brown", "linda howard",
  "maya banks", "sylvia day", "j.r. ward", "rachel van dyken",
  "meghan march", "devney perry", "katee robert", "sarah maclean",
]);

function isLikelyRomanceAuthor(author: string): boolean {
  return KNOWN_ROMANCE_AUTHORS_LOWER.has(author.toLowerCase().trim());
}

async function seedFromNYTArchive() {
  console.log("\n━━━ SOURCE 2: NYT Bestsellers Archive ━━━");

  const apiKey = process.env.NYT_BOOKS_API_KEY;
  if (!apiKey) {
    console.warn("⚠️  NYT_BOOKS_API_KEY not set — skipping NYT archive");
    return;
  }

  // Go back 24 months, sampling every 4 weeks (6 dates to stay under rate limits)
  const dates: string[] = [];
  const now = new Date();
  for (let monthsBack = 0; monthsBack < 24; monthsBack += 4) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - monthsBack);
    dates.push(d.toISOString().split("T")[0]);
  }

  const seenTitles = new Set<string>();
  const booksToResolve: { title: string; author: string }[] = [];

  for (const date of dates) {
    for (const listName of NYT_LISTS) {
      const url = `https://api.nytimes.com/svc/books/v3/lists/${date}/${listName}.json?api-key=${apiKey}`;
      console.log(`  Fetching ${listName} for ${date}...`);

      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.warn(`    HTTP ${res.status}`);
          continue;
        }
        const data = await res.json();
        const books = data.results?.books ?? [];

        for (const book of books) {
          const key = `${book.title?.toLowerCase()}::${book.author?.toLowerCase()}`;
          if (seenTitles.has(key)) continue;
          seenTitles.add(key);

          // Only keep books by known romance authors
          if (isLikelyRomanceAuthor(book.author)) {
            booksToResolve.push({ title: book.title, author: book.author });
          }
        }
      } catch (err) {
        console.warn(`    Error:`, err);
      }

      // NYT rate limit: 5 req/min
      await sleep(12000);
    }
  }

  console.log(`\n  Found ${booksToResolve.length} romance titles from NYT archive`);

  // Resolve each to Goodreads
  const goodreadsIds: string[] = [];
  for (const book of booksToResolve) {
    if (processedGoodreadsIds.has(book.title.toLowerCase())) continue;

    console.log(`  Resolving: "${book.title}" by ${book.author}`);
    const results = await searchGoodreads(`${book.title} ${book.author}`);

    if (results.length > 0) {
      const topResult = results[0];
      // Basic title match check
      const titleLower = book.title.toLowerCase();
      const resultTitleLower = topResult.title.toLowerCase();
      if (
        resultTitleLower.includes(titleLower) ||
        titleLower.includes(resultTitleLower) ||
        titleLower.split(/\s+/).filter((w) => w.length > 3).every((w) => resultTitleLower.includes(w))
      ) {
        goodreadsIds.push(topResult.goodreadsId);
      }
    }

    await sleep(1500);
  }

  console.log(`  Resolved ${goodreadsIds.length} to Goodreads IDs`);
  await processBatch(goodreadsIds, "nytArchive", "NYT Archive");
}

// ── SOURCE 3: Popular Author Catalogs ───────────────

const SEED_AUTHORS = [
  "Emily Henry",
  "Colleen Hoover",
  "Ali Hazelwood",
  "Sarah J. Maas",
  "Rebecca Yarros",
  "Jennifer L. Armentrout",
  "Penelope Douglas",
  "Lucy Score",
  "Tessa Bailey",
  "Ana Huang",
  "Elsie Silver",
  "Hannah Grace",
  "Abby Jimenez",
  "Lynn Painter",
  "Lisa Kleypas",
  "Nora Roberts",
  "Julia Quinn",
  "Christina Lauren",
  "Elle Kennedy",
  "Mariana Zapata",
  "Talia Hibbert",
  "Kennedy Ryan",
  "Helena Hunting",
  "Jasmine Guillory",
  "Helen Hoang",
  "Kresley Cole",
  "Nalini Singh",
  "Ilona Andrews",
  "Karen Marie Moning",
  "Sarah MacLean",
  "Kerri Maniscalco",
  "Caroline Peckham",
  "Lauren Roberts",
  "Callie Hart",
  "Holly Black",
  "Cassandra Clare",
  "Diana Gabaldon",
  "Sylvia Day",
  "Meghan March",
  "Katee Robert",
];

/**
 * Search Goodreads for an author's books and process results.
 */
async function seedAuthorCatalog(author: string) {
  console.log(`\n👤 ${author}`);

  // Search 1: "author name" to get their popular books
  const results1 = await searchGoodreads(author);

  // Search 2: "books by author name" for more variety
  await sleep(1500);
  const results2 = await searchGoodreads(`books by ${author}`);

  // Merge and dedupe
  const seen = new Set<string>();
  const allResults = [];
  for (const r of [...results1, ...results2]) {
    if (seen.has(r.goodreadsId)) continue;
    seen.add(r.goodreadsId);

    // Only include books by this author (search sometimes returns others)
    const authorLower = author.toLowerCase();
    const resultAuthorLower = r.author.toLowerCase();
    if (
      resultAuthorLower.includes(authorLower.split(" ").pop()!) ||
      authorLower.split(" ").pop() &&
        resultAuthorLower.includes(authorLower.split(" ").pop()!)
    ) {
      allResults.push(r);
    }
  }

  console.log(`  Found ${allResults.length} books`);

  // Process each book
  let batchCount = 0;
  for (const result of allResults) {
    if (isJunkTitle(result.title)) continue;
    await processGoodreadsBook(result.goodreadsId, "authorCatalogs");
    batchCount++;

    if (batchCount >= BATCH_SIZE) {
      await sleep(BATCH_DELAY_MS);
      batchCount = 0;
    }
  }
}

async function seedFromAuthorCatalogs() {
  console.log("\n━━━ SOURCE 3: Popular Author Catalogs ━━━");

  for (const author of SEED_AUTHORS) {
    await seedAuthorCatalog(author);
    await sleep(3000); // Pause between authors
  }
}

// ── Main ─────────────────────────────────────────────

async function main() {
  console.log("🔥 Hotlist Book Seeder");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Started at ${new Date().toLocaleString()}\n`);

  // Verify env
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  // Run sources in order (not parallel — respect Goodreads rate limits)
  await seedFromGoodreadsLists();
  await seedFromAuthorCatalogs();
  await seedFromNYTArchive();

  // Final report
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 SEEDING COMPLETE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`\nGoodreads Lists:`);
  console.log(`  Attempted: ${stats.goodreadsLists.attempted}`);
  console.log(`  Saved:     ${stats.goodreadsLists.saved}`);
  console.log(`  Skipped:   ${stats.goodreadsLists.skipped}`);
  console.log(`  Errors:    ${stats.goodreadsLists.errors}`);
  console.log(`\nAuthor Catalogs:`);
  console.log(`  Attempted: ${stats.authorCatalogs.attempted}`);
  console.log(`  Saved:     ${stats.authorCatalogs.saved}`);
  console.log(`  Skipped:   ${stats.authorCatalogs.skipped}`);
  console.log(`  Errors:    ${stats.authorCatalogs.errors}`);
  console.log(`\nNYT Archive:`);
  console.log(`  Attempted: ${stats.nytArchive.attempted}`);
  console.log(`  Saved:     ${stats.nytArchive.saved}`);
  console.log(`  Skipped:   ${stats.nytArchive.skipped}`);
  console.log(`  Errors:    ${stats.nytArchive.errors}`);

  const totalSaved =
    stats.goodreadsLists.saved +
    stats.authorCatalogs.saved +
    stats.nytArchive.saved;
  const totalProcessed = processedGoodreadsIds.size;

  console.log(`\n🔥 TOTAL: ${totalSaved} books saved (${totalProcessed} unique IDs processed)`);
  console.log(`\nFinished at ${new Date().toLocaleString()}`);
  console.log("\nNext steps:");
  console.log("  1. Run enrichment: curl -X POST http://localhost:3000/api/books/enrich-batch");
  console.log("  2. Refresh NYT:    curl -X POST http://localhost:3000/api/nyt/refresh");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
