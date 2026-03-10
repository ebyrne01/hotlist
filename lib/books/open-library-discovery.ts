/**
 * OPEN LIBRARY SUBJECT CRAWL
 *
 * Uses Open Library's free subject API to bulk-discover romance books,
 * then resolves each to a Goodreads ID before saving.
 *
 * Shared logic used by both the CLI seed script and the cron API route.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { resolveToGoodreadsId, getGoodreadsBookById } from "./goodreads-search";
import { saveGoodreadsBookToCache } from "./cache";
import { scheduleEnrichment } from "@/lib/scraping";
import { scheduleMetadataEnrichment } from "./metadata-enrichment";
import { isJunkTitle } from "./romance-filter";

const OL_DELAY_MS = 1000; // 1 req/sec for Open Library
const GOODREADS_DELAY_MS = 1500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** All romance-adjacent subjects to crawl. */
export const OL_SUBJECTS = [
  "romance",
  "love_stories",
  "romantic_fiction",
  "fantasy_romance",
  "romantic_suspense",
  "paranormal_romance",
] as const;

export type OLSubject = (typeof OL_SUBJECTS)[number];

interface OLWork {
  key: string; // e.g. "/works/OL12345W"
  title: string;
  authors: { name: string }[];
}

interface OLSubjectResponse {
  work_count: number;
  works: OLWork[];
}

export interface OLDiscoveryProgress {
  total: number;
  processed: number;
  resolved: number;
  added: number;
  skipped: number;
  errors: number;
}

/**
 * Fetch one page of works from an Open Library subject.
 * Returns the works array and total work count.
 */
export async function fetchSubjectPage(
  subject: string,
  limit = 50,
  offset = 0
): Promise<{ works: OLWork[]; totalCount: number }> {
  const url = `https://openlibrary.org/subjects/${subject}.json?limit=${limit}&offset=${offset}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Hotlist/1.0 (myhotlist.app; book aggregator for romance readers)",
    },
  });

  if (!res.ok) {
    throw new Error(`Open Library API returned ${res.status} for ${subject}`);
  }

  const data: OLSubjectResponse = await res.json();
  return {
    works: data.works ?? [],
    totalCount: data.work_count ?? 0,
  };
}

/**
 * Crawl multiple pages of an Open Library subject.
 * Returns all discovered works (up to maxPages * pageSize).
 */
export async function crawlSubject(
  subject: string,
  maxPages = 4,
  pageSize = 50
): Promise<OLWork[]> {
  const allWorks: OLWork[] = [];

  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    await sleep(OL_DELAY_MS);

    try {
      const { works } = await fetchSubjectPage(subject, pageSize, offset);
      if (works.length === 0) break;
      allWorks.push(...works);
    } catch {
      break;
    }
  }

  return allWorks;
}

/**
 * Process discovered Open Library works: resolve to Goodreads, fetch details, save.
 *
 * @param works - Works from crawlSubject
 * @param timeBudgetMs - Max time to spend (0 = unlimited)
 * @param onProgress - Optional callback for logging
 * @returns Final progress stats
 */
export async function processOLWorks(
  works: OLWork[],
  timeBudgetMs = 0,
  onProgress?: (msg: string, progress: OLDiscoveryProgress) => void
): Promise<OLDiscoveryProgress> {
  const supabase = getAdminClient();
  const startTime = Date.now();
  const progress: OLDiscoveryProgress = {
    total: works.length,
    processed: 0,
    resolved: 0,
    added: 0,
    skipped: 0,
    errors: 0,
  };

  // Pre-fetch existing titles for fast dedup (rough check before expensive Goodreads calls)
  const { data: existingRows } = await supabase
    .from("books")
    .select("title, goodreads_id")
    .limit(5000);
  const existingTitles = new Set(
    (existingRows ?? []).map((r) => (r.title as string).toLowerCase())
  );
  const existingGoodreadsIds = new Set(
    (existingRows ?? []).map((r) => r.goodreads_id as string)
  );

  for (const work of works) {
    // Check time budget
    if (timeBudgetMs > 0 && Date.now() - startTime > timeBudgetMs) {
      onProgress?.(
        `[ol-discovery] Time budget reached after ${progress.processed} works`,
        progress
      );
      break;
    }

    progress.processed++;

    const title = work.title;
    const author = work.authors?.[0]?.name ?? "Unknown Author";

    // Skip junk titles
    if (isJunkTitle(title)) {
      progress.skipped++;
      continue;
    }

    // Quick dedup: skip if title already exists (rough match)
    if (existingTitles.has(title.toLowerCase())) {
      progress.skipped++;
      continue;
    }

    try {
      // Resolve to Goodreads ID (this is the expensive step)
      await sleep(GOODREADS_DELAY_MS);
      const goodreadsId = await resolveToGoodreadsId(title, author);

      if (!goodreadsId) {
        progress.errors++;
        continue;
      }

      progress.resolved++;

      // Skip if already in DB by Goodreads ID
      if (existingGoodreadsIds.has(goodreadsId)) {
        progress.skipped++;
        continue;
      }

      // Fetch full details from Goodreads
      await sleep(GOODREADS_DELAY_MS);
      const detail = await getGoodreadsBookById(goodreadsId);
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
        existingGoodreadsIds.add(goodreadsId);
        existingTitles.add(title.toLowerCase());
        scheduleMetadataEnrichment(book.id, book.title, book.author, book.isbn);
        scheduleEnrichment(book.id, book.title, book.author, book.isbn);
        onProgress?.(
          `[ol-discovery] Saved "${book.title}" by ${book.author} (${progress.processed}/${progress.total})`,
          progress
        );
      }
    } catch {
      progress.errors++;
    }
  }

  return progress;
}
