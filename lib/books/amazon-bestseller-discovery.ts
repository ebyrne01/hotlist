/**
 * AMAZON BESTSELLER DISCOVERY
 *
 * Uses Serper to find books from Amazon's romance bestseller lists.
 * Extracts title + author from search results, then resolves each
 * through Goodreads search and saves to the database.
 *
 * Amazon blocks direct scraping (503), so we lean on Google's
 * indexing of Amazon bestseller pages via Serper search results.
 *
 * Cost: ~$0.005 per run (5 Serper queries × $0.001 each).
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { searchGoodreads, getGoodreadsBookById } from "./goodreads-search";
import { saveGoodreadsBookToCache } from "./cache";
import { queueEnrichmentJobs } from "@/lib/enrichment/queue";
import { scheduleMetadataEnrichment } from "./metadata-enrichment";
import { isJunkTitle, isRomanceByGenres } from "./romance-filter";
import { recordBuzzSignalsBatch } from "./buzz-signals";

const GOODREADS_DELAY_MS = 1500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serper queries that surface Amazon romance bestseller titles */
const BESTSELLER_QUERIES = [
  'site:amazon.com "Best Sellers in Romance" books',
  'site:amazon.com "Best Sellers in Fantasy Romance" books',
  'site:amazon.com "Best Sellers in Romantic Suspense" books',
  'site:amazon.com "Best Sellers in Contemporary Romance" books',
  'site:amazon.com "Best Sellers in Paranormal Romance" books',
];

interface DiscoveredBook {
  title: string;
  author: string;
}

interface DiscoveryProgress {
  queriesRun: number;
  titlesExtracted: number;
  resolved: number;
  added: number;
  skipped: number;
  errors: number;
}

/**
 * Extract book titles and authors from Serper organic results.
 * Amazon bestseller results often have titles like:
 *   "Book Title: Subtitle (Series Name Book 1) - Author Name"
 *   "#1 Best Seller in Romance | Book Title by Author Name"
 */
function extractBooksFromResults(
  results: { title?: string; snippet?: string; link?: string }[]
): DiscoveredBook[] {
  const books: DiscoveredBook[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    const extracted = extractFromResult(result);
    for (const book of extracted) {
      const key = `${book.title.toLowerCase()}::${book.author.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!isJunkTitle(book.title)) {
        books.push(book);
      }
    }
  }

  return books;
}

function extractFromResult(result: {
  title?: string;
  snippet?: string;
  link?: string;
}): DiscoveredBook[] {
  const books: DiscoveredBook[] = [];

  // Amazon product page URLs contain the title in the path:
  // amazon.com/Book-Title-Author/dp/ASIN
  // The <title> often is: "Book Title: Subtitle - Author Name"
  const title = result.title ?? "";
  const snippet = result.snippet ?? "";

  // Pattern 1: "Book Title by Author Name" in title or snippet
  const byPattern = /^(.+?)\s+by\s+([A-Z][a-zA-Z.''-]+(?:\s+[A-Z][a-zA-Z.''-]+){0,3})/;

  // Pattern 2: Amazon title format — "Book Title: Subtitle - Kindle edition by Author"
  const kindlePattern =
    /^(.+?)(?:\s*[-–:]\s*(?:Kindle edition|Paperback|Hardcover))?\s+by\s+(.+?)(?:\s*\||\s*$)/i;

  // Try title first
  const match = title.match(kindlePattern) || title.match(byPattern);
  if (match) {
    const bookTitle = cleanTitle(match[1]);
    const author = cleanAuthor(match[2]);
    if (bookTitle.length > 2 && author.length > 2) {
      books.push({ title: bookTitle, author });
    }
  }

  // Also try extracting from snippet — bestseller list pages often have
  // multiple "Title by Author" mentions
  const snippetMatches = Array.from(
    snippet.matchAll(
      /([A-Z][^.!?]*?)\s+by\s+([A-Z][a-zA-Z.''-]+(?:\s+[A-Z][a-zA-Z.''-]+){0,3})/g
    )
  );
  for (const m of snippetMatches) {
    const bookTitle = cleanTitle(m[1]);
    const author = cleanAuthor(m[2]);
    if (
      bookTitle.length > 2 &&
      bookTitle.length < 100 &&
      author.length > 2 &&
      !bookTitle.toLowerCase().includes("best seller") &&
      !bookTitle.toLowerCase().includes("amazon")
    ) {
      books.push({ title: bookTitle, author });
    }
  }

  return books;
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/\s*\(.*?\)\s*/g, " ") // Remove parentheticals (Series Book 1)
    .replace(/\s*[-–:]\s*(?:A Novel|A Romance|Book \d+)$/i, "")
    .replace(/^\s*#\d+\s*/, "") // Remove "#1 " prefix
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAuthor(raw: string): string {
  return raw
    .replace(/\s*\(.*?\)\s*/g, "")
    .replace(/\s*,\s*$/, "")
    .trim();
}

/**
 * Run a single Serper search and return organic results.
 */
async function searchSerper(
  apiKey: string,
  query: string
): Promise<{ title?: string; snippet?: string; link?: string }[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      num: 20,
      gl: "us",
    }),
  });

  if (!res.ok) {
    console.warn(`[amazon-bestsellers] Serper returned ${res.status}`);
    return [];
  }

  const data = await res.json();
  return data.organic ?? [];
}

/**
 * Discover books from Amazon bestseller lists and add them to the database.
 *
 * @param timeBudgetMs Max time to spend (0 = unlimited)
 * @param onProgress Optional log callback
 */
export async function discoverAmazonBestsellers(
  timeBudgetMs = 0,
  onProgress?: (msg: string) => void
): Promise<DiscoveryProgress> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn("[amazon-bestsellers] SERPER_API_KEY not set");
    return { queriesRun: 0, titlesExtracted: 0, resolved: 0, added: 0, skipped: 0, errors: 0 };
  }

  const startTime = Date.now();
  const progress: DiscoveryProgress = {
    queriesRun: 0,
    titlesExtracted: 0,
    resolved: 0,
    added: 0,
    skipped: 0,
    errors: 0,
  };

  const supabase = getAdminClient();
  const allBooks: DiscoveredBook[] = [];

  // Step 1: Search Serper for Amazon bestseller pages
  for (const query of BESTSELLER_QUERIES) {
    if (timeBudgetMs > 0 && Date.now() - startTime > timeBudgetMs * 0.3) break;

    try {
      const results = await searchSerper(apiKey, query);
      progress.queriesRun++;

      const extracted = extractBooksFromResults(results);
      allBooks.push(...extracted);
      onProgress?.(
        `[amazon-bestsellers] Query "${query.slice(0, 50)}..." → ${extracted.length} titles`
      );
    } catch (err) {
      console.warn("[amazon-bestsellers] Query failed:", err);
    }
  }

  // Deduplicate across all queries
  const seen = new Set<string>();
  const unique: DiscoveredBook[] = [];
  for (const book of allBooks) {
    const key = `${book.title.toLowerCase()}::${book.author.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(book);
  }

  progress.titlesExtracted = unique.length;
  onProgress?.(
    `[amazon-bestsellers] ${unique.length} unique titles extracted from ${progress.queriesRun} queries`
  );

  // Step 2: Check which titles are already in our database — record buzz for existing books
  const existingKeys = new Set<string>();
  const existingBuzzIds: string[] = [];
  for (const book of unique) {
    const { data } = await supabase
      .from("books")
      .select("id")
      .ilike("title", book.title)
      .limit(1);
    if (data && data.length > 0) {
      existingKeys.add(`${book.title.toLowerCase()}::${book.author.toLowerCase()}`);
      existingBuzzIds.push(data[0].id);
    }
  }

  // Record buzz signals for books already in our DB
  if (existingBuzzIds.length > 0) {
    await recordBuzzSignalsBatch(
      existingBuzzIds.map((id) => ({ bookId: id, source: "amazon_bestseller" as const }))
    );
    onProgress?.(
      `[amazon-bestsellers] Recorded buzz signals for ${existingBuzzIds.length} existing books`
    );
  }

  const toResolve = unique.filter(
    (b) =>
      !existingKeys.has(`${b.title.toLowerCase()}::${b.author.toLowerCase()}`)
  );

  onProgress?.(
    `[amazon-bestsellers] ${toResolve.length} new titles to resolve (${existingKeys.size} already in DB)`
  );

  // Step 3: Resolve each new title via Goodreads search
  for (const book of toResolve) {
    if (timeBudgetMs > 0 && Date.now() - startTime > timeBudgetMs) break;

    try {
      await sleep(GOODREADS_DELAY_MS);

      const results = await searchGoodreads(`${book.title} ${book.author}`);
      if (!results || results.length === 0) {
        progress.errors++;
        continue;
      }

      // Find best match — title should be similar
      const best = results.find((r) =>
        r.title.toLowerCase().includes(book.title.toLowerCase().slice(0, 20))
      ) ?? results[0];

      if (!best?.goodreadsId) {
        progress.errors++;
        continue;
      }

      progress.resolved++;

      // Fetch full details from Goodreads
      const detail = await getGoodreadsBookById(best.goodreadsId);
      if (!detail) {
        progress.errors++;
        continue;
      }

      // Romance gate — make sure it's actually romance
      const genres = detail.genres ?? [];
      if (genres.length > 0 && !isRomanceByGenres(genres)) {
        progress.skipped++;
        continue;
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
        await recordBuzzSignalsBatch([
          { bookId: saved.id, source: "amazon_bestseller" },
        ]);
        progress.added++;
        scheduleMetadataEnrichment(saved.id, saved.title, saved.author, saved.isbn);
        await queueEnrichmentJobs(saved.id, saved.title, saved.author);
        onProgress?.(
          `[amazon-bestsellers] Added "${saved.title}" by ${saved.author}`
        );
      } else {
        progress.skipped++;
      }
    } catch {
      progress.errors++;
    }
  }

  return progress;
}
