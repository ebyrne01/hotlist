/**
 * GOODREADS LIST CRAWLER
 *
 * Crawls curated Goodreads lists to discover popular romance/romantasy books.
 * Shared logic used by both the CLI seed script and the cron API route.
 */

import * as cheerio from "cheerio";
import { getAdminClient } from "@/lib/supabase/admin";
import { extractGoodreadsId, getGoodreadsBookById } from "./goodreads-search";
import { saveGoodreadsBookToCache } from "./cache";
import { scheduleEnrichment } from "@/lib/scraping";
import { scheduleMetadataEnrichment } from "./metadata-enrichment";
import { isJunkTitle } from "./romance-filter";

const GOODREADS_DELAY_MS = 1500;
const USER_AGENT =
  "Hotlist/1.0 (myhotlist.app; book aggregator for romance readers)";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** All curated list URLs to seed from. */
export const SEED_LIST_URLS = [
  // --- Core romance lists ---
  "https://www.goodreads.com/list/show/18500.Best_Romance_of_the_Decade_2020s",
  "https://www.goodreads.com/list/show/9951.Best_Romance_Novels",
  "https://www.goodreads.com/list/show/47.Best_Romance_of_the_21st_Century",
  "https://www.goodreads.com/list/show/5937.Best_Romance_Books_on_Booktok",

  // --- Romantasy / fantasy romance ---
  "https://www.goodreads.com/list/show/34735.Romantasy_Romantic_Fantasy",
  "https://www.goodreads.com/list/show/151423.Best_Fantasy_Romance",
  "https://www.goodreads.com/list/show/7159.Best_Paranormal_Romance_Series",
  "https://www.goodreads.com/list/show/3647.Best_Fae_Fantasy_Romance",

  // --- Subgenres ---
  "https://www.goodreads.com/list/show/11856.Best_Historical_Romance",
  "https://www.goodreads.com/list/show/16745.Best_Contemporary_Romance",
  "https://www.goodreads.com/list/show/47722.Best_Dark_Romance",
  "https://www.goodreads.com/list/show/7413.Best_Romantic_Suspense",
  "https://www.goodreads.com/list/show/157075.Best_Spicy_Romance",

  // --- Trope-specific ---
  "https://www.goodreads.com/list/show/142342.Best_Enemies_to_Lovers_Romance",
  "https://www.goodreads.com/list/show/174498.Best_Grumpy_Sunshine_Romance",
  "https://www.goodreads.com/list/show/36956.Best_Slow_Burn_Romance",
  "https://www.goodreads.com/list/show/10745.Best_Friends_to_Lovers_Romance",
  "https://www.goodreads.com/list/show/18816.Best_Fake_Relationship_Romance",
  "https://www.goodreads.com/list/show/15399.Best_Second_Chance_Romance",
  "https://www.goodreads.com/list/show/63775.Best_Forced_Proximity_Romance",

  // --- Year-based (catch new releases) ---
  "https://www.goodreads.com/list/show/22833.Most_Popular_Books_Published_In_2024",
  "https://www.goodreads.com/list/show/171039.Most_Popular_Books_Published_In_2025",
  "https://www.goodreads.com/list/show/185279.Most_Popular_Books_Published_In_2026",
  "https://www.goodreads.com/list/show/171040.Most_Anticipated_Books_of_2026",
];

interface ListEntry {
  goodreadsId: string;
  title: string;
  author: string;
}

/**
 * Crawl a Goodreads list across multiple pages.
 * Returns all discovered book entries (up to maxPages pages).
 */
export async function crawlList(
  listUrl: string,
  maxPages = 3
): Promise<ListEntry[]> {
  const allEntries: ListEntry[] = [];
  let currentUrl: string | null = listUrl;

  for (let page = 0; page < maxPages && currentUrl; page++) {
    await sleep(GOODREADS_DELAY_MS);

    try {
      const res = await fetch(currentUrl, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
      });
      if (!res.ok) break;

      const html = await res.text();
      const $ = cheerio.load(html);
      const entries: ListEntry[] = [];

      $("tr[itemtype='http://schema.org/Book']").each((_, row) => {
        const $row = $(row);
        const titleLink = $row.find("a.bookTitle");
        const title =
          titleLink.find("span[itemprop='name']").text().trim() ||
          titleLink.text().trim();
        const href = titleLink.attr("href") ?? "";
        const goodreadsId = extractGoodreadsId(href);
        if (!goodreadsId || !title) return;

        const author =
          $row
            .find("a.authorName span[itemprop='name']")
            .first()
            .text()
            .trim() ||
          $row.find("a.authorName").first().text().trim() ||
          "Unknown Author";

        entries.push({ goodreadsId, title, author });
      });

      allEntries.push(...entries);

      // Find next page link
      const nextLink = $("a.next_page").attr("href");
      if (!nextLink) break;
      currentUrl = nextLink.startsWith("http")
        ? nextLink
        : `https://www.goodreads.com${nextLink}`;
    } catch {
      break;
    }
  }

  return allEntries;
}

export interface SeedProgress {
  total: number;
  processed: number;
  added: number;
  skipped: number;
  errors: number;
}

/**
 * Process a list of discovered books: check cache, fetch details, save new ones.
 *
 * @param entries - Book entries from crawlList
 * @param timeBudgetMs - Max time to spend (0 = unlimited)
 * @param onProgress - Optional callback for logging progress
 * @returns Final progress stats
 */
export async function processListEntries(
  entries: ListEntry[],
  timeBudgetMs = 0,
  onProgress?: (msg: string, progress: SeedProgress) => void
): Promise<SeedProgress> {
  const supabase = getAdminClient();
  const startTime = Date.now();
  const progress: SeedProgress = {
    total: entries.length,
    processed: 0,
    added: 0,
    skipped: 0,
    errors: 0,
  };

  // Pre-fetch all existing goodreads_ids for fast dedup
  const entryIds = entries.map((e) => e.goodreadsId);
  const { data: existingRows } = await supabase
    .from("books")
    .select("goodreads_id")
    .in("goodreads_id", entryIds);
  const existingIds = new Set(
    (existingRows ?? []).map((r) => r.goodreads_id as string)
  );

  for (const entry of entries) {
    // Check time budget
    if (timeBudgetMs > 0 && Date.now() - startTime > timeBudgetMs) {
      onProgress?.(
        `[seed-lists] Time budget reached after ${progress.processed} books`,
        progress
      );
      break;
    }

    progress.processed++;

    // Skip if already in DB
    if (existingIds.has(entry.goodreadsId)) {
      progress.skipped++;
      continue;
    }

    // Skip junk titles
    if (isJunkTitle(entry.title)) {
      progress.skipped++;
      continue;
    }

    try {
      const detail = await getGoodreadsBookById(entry.goodreadsId);
      if (!detail) {
        progress.errors++;
        continue;
      }

      const book = await saveGoodreadsBookToCache({
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

      if (book) {
        progress.added++;
        existingIds.add(entry.goodreadsId);
        scheduleMetadataEnrichment(
          book.id,
          book.title,
          book.author,
          book.isbn
        );
        scheduleEnrichment(book.id, book.title, book.author, book.isbn);
        onProgress?.(
          `[seed-lists] Saved "${book.title}" by ${book.author} (${progress.processed} of ${progress.total})`,
          progress
        );
      }
    } catch {
      progress.errors++;
    }
  }

  return progress;
}
