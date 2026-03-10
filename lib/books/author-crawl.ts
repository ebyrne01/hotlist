/**
 * AUTHOR BIBLIOGRAPHY CRAWL
 *
 * Given a Goodreads book page, extract the author's Goodreads author ID,
 * then crawl their author page to discover all their books.
 * Save any new books to the Supabase cache.
 *
 * This runs as a background task — never block the user on this.
 * Rate limit: 1.5s delay between Goodreads requests (same as goodreads-search.ts).
 */

import * as cheerio from "cheerio";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  getGoodreadsBookById,
  extractGoodreadsId,
  type GoodreadsSearchResult,
} from "./goodreads-search";
import { saveGoodreadsBookToCache } from "./cache";
import { scheduleMetadataEnrichment } from "./metadata-enrichment";
import { scheduleEnrichment } from "@/lib/scraping";
import { isJunkTitle } from "./romance-filter";

const GOODREADS_DELAY_MS = 1500;
const USER_AGENT =
  "Hotlist/1.0 (myhotlist.app; book aggregator for romance readers)";
const CRAWL_COOLDOWN_DAYS = 7;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract the Goodreads author ID from a book page.
 * Fetches the book page and looks for an author profile link.
 */
async function extractAuthorId(
  goodreadsBookId: string
): Promise<string | null> {
  await sleep(GOODREADS_DELAY_MS);

  const url = `https://www.goodreads.com/book/show/${goodreadsBookId}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    // Look for author profile link
    const authorLink =
      $('a[href*="/author/show/"]').first().attr("href") ?? null;
    if (!authorLink) return null;

    const match = authorLink.match(/\/author\/show\/(\d+)/);
    return match ? match[1] : null;
  } catch (err) {
    console.warn("[author-crawl] Failed to extract author ID:", err);
    return null;
  }
}

/**
 * Crawl a Goodreads author page to discover all their books.
 * Returns basic search-result-style data for each book found.
 */
async function crawlAuthorBooks(
  authorId: string,
  maxBooks = 30
): Promise<GoodreadsSearchResult[]> {
  await sleep(GOODREADS_DELAY_MS);

  const url = `https://www.goodreads.com/author/list/${authorId}?page=1&per_page=30`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
    if (!res.ok) {
      console.warn(
        `[author-crawl] HTTP ${res.status} for author ${authorId}`
      );
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const results: GoodreadsSearchResult[] = [];

    $("tr[itemtype='http://schema.org/Book']").each((i, row) => {
      if (results.length >= maxBooks) return false;

      const $row = $(row);

      // Title + link
      const titleLink = $row.find("a.bookTitle");
      const title =
        titleLink.find("span[itemprop='name']").text().trim() ||
        titleLink.text().trim();
      const href = titleLink.attr("href") ?? "";
      const goodreadsId = extractGoodreadsId(href);
      if (!goodreadsId || !title) return;

      const goodreadsUrl = `https://www.goodreads.com${href.split("?")[0]}`;

      // Author
      const author =
        $row
          .find("a.authorName span[itemprop='name']")
          .first()
          .text()
          .trim() ||
        $row.find("a.authorName").first().text().trim();

      // Cover
      let coverUrl = $row.find("img.bookCover").attr("src") ?? null;
      if (coverUrl) {
        coverUrl = coverUrl.replace(/_S[XY]\d+_/, "_SX200_");
      }

      // Rating
      const miniratingText = $row.find(".minirating").text();
      let rating: number | null = null;
      let ratingCount: number | null = null;

      const ratingMatch = miniratingText.match(/([\d.]+)\s*avg\s*rating/);
      if (ratingMatch) rating = parseFloat(ratingMatch[1]);

      const countMatch = miniratingText.match(/([\d,]+)\s*rating/);
      if (countMatch)
        ratingCount = parseInt(countMatch[1].replace(/,/g, ""), 10);

      results.push({
        goodreadsId,
        goodreadsUrl,
        title,
        author: author || "Unknown Author",
        coverUrl,
        rating,
        ratingCount,
      });
    });

    return results;
  } catch (err) {
    console.warn("[author-crawl] Failed to crawl author page:", err);
    return [];
  }
}

/**
 * Fire-and-forget: crawl an author's bibliography and save new books to cache.
 *
 * Guards:
 * - Skips if we already have 10+ books by this author
 * - Skips if author_crawled_at is less than 7 days old for any book by this author
 */
export function scheduleAuthorCrawl(
  goodreadsBookId: string,
  authorName: string
): void {
  runAuthorCrawl(goodreadsBookId, authorName).catch((err) => {
    console.warn("[author-crawl] Background crawl failed:", err);
  });
}

async function runAuthorCrawl(
  goodreadsBookId: string,
  authorName: string
): Promise<void> {
  const supabase = getAdminClient();

  // Check how many books by this author we already have
  // and whether we've recently crawled
  const { data: existingBooks } = await supabase
    .from("books")
    .select("goodreads_id, author_crawled_at")
    .ilike("author", `%${authorName}%`)
    .limit(15);

  if (!existingBooks) return;

  // Skip if we already have plenty of books
  if (existingBooks.length >= 10) {
    return;
  }

  // Skip if we crawled recently (within CRAWL_COOLDOWN_DAYS)
  const recentCrawl = existingBooks.find((b) => {
    if (!b.author_crawled_at) return false;
    const age = Date.now() - new Date(b.author_crawled_at).getTime();
    return age < CRAWL_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  });
  if (recentCrawl) {
    return;
  }

  // Extract the author's Goodreads ID from the book page
  const authorId = await extractAuthorId(goodreadsBookId);
  if (!authorId) {
    console.warn(
      `[author-crawl] Could not find author ID for book ${goodreadsBookId}`
    );
    return;
  }

  // Crawl the author's bibliography
  const authorBooks = await crawlAuthorBooks(authorId);
  if (authorBooks.length === 0) return;

  // Find which books we already have
  const existingIds = new Set(existingBooks.map((b) => b.goodreads_id));
  const newBooks = authorBooks.filter(
    (b) => !existingIds.has(b.goodreadsId) && !isJunkTitle(b.title)
  );

  let discovered = 0;

  for (const result of newBooks) {
    try {
      const detail = await getGoodreadsBookById(result.goodreadsId);
      if (!detail) continue;

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
        discovered++;
        scheduleMetadataEnrichment(
          book.id,
          book.title,
          book.author,
          book.isbn
        );
        scheduleEnrichment(book.id, book.title, book.author, book.isbn);
      }
    } catch {
      // Continue with remaining books if one fails
    }
  }

  // Mark crawl timestamp on the triggering book
  await supabase
    .from("books")
    .update({ author_crawled_at: new Date().toISOString() })
    .eq("goodreads_id", goodreadsBookId);

  if (discovered > 0) {
    console.log(
      `[author-crawl] Discovered ${discovered} new books by ${authorName}`
    );
  }
}
