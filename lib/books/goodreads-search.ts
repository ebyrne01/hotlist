/**
 * GOODREADS SEARCH + METADATA
 *
 * Goodreads is the canonical book identity source for Hotlist.
 * Every book in our database must have a Goodreads ID.
 *
 * We scrape Goodreads respectfully: rate-limited, cached, and only when needed.
 *
 * Extracted per book:
 * - Goodreads ID (from the book URL)
 * - Title (canonical)
 * - Author (canonical)
 * - Cover image URL
 * - Average rating + ratings count
 * - Genres / shelf tags (top community shelves)
 * - Series name and position (if applicable)
 * - Goodreads URL
 */

import * as cheerio from "cheerio";
import {
  isCircuitOpen,
  recordSuccess,
  recordFailure,
} from "@/lib/scraping/goodreads-circuit-breaker";

const GOODREADS_DELAY_MS = 1500;
const GOODREADS_SEARCH_URL = "https://www.goodreads.com/search?q=";
const USER_AGENT =
  "Mozilla/5.0 (compatible; BookMetadata/1.0)";

// ── Types ─────────────────────────────────────────────

export interface GoodreadsSearchResult {
  goodreadsId: string;
  goodreadsUrl: string;
  title: string;
  author: string;
  coverUrl: string | null;
  rating: number | null;
  ratingCount: number | null;
}

export interface GoodreadsBookDetail extends GoodreadsSearchResult {
  description: string | null;
  genres: string[];
  seriesName: string | null;
  seriesPosition: number | null;
  publishedYear: number | null;
  pageCount: number | null;
}

// ── Helpers ───────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract the Goodreads book ID from a URL path like /book/show/17675462-title */
export function extractGoodreadsId(urlOrPath: string): string | null {
  const match = urlOrPath.match(/\/show\/(\d+)/);
  return match ? match[1] : null;
}

/** Normalize text for comparison: lowercase, strip punctuation, collapse spaces */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^\w\s']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Simple similarity check: what fraction of words in `a` appear in `b`. */
function wordOverlap(a: string, b: string): number {
  const wordsA = normalize(a).split(" ");
  const wordsB = new Set(normalize(b).split(" "));
  if (wordsA.length === 0) return 0;
  const matches = wordsA.filter((w) => wordsB.has(w)).length;
  return matches / wordsA.length;
}

/** Patterns that indicate a study guide, summary, or non-original-work listing */
const JUNK_SEARCH_TITLE_PATTERNS = [
  /^study guide:/i,
  /^summary\b/i,
  /\bstudy guide\b/i,
  /\bcollection set\b/i,
  /\bbooks collection\b/i,
  /\bbook set\b/i,
  /\bconversation starters\b/i,
  /\bcritic view\b/i,
  /\bliterary analysis\b/i,
  /\bstudent workbook\b/i,
  /\breading guide\b/i,
  /\bdiscussion resource\b/i,
  /\bfigurine\b/i,
  /\bbookmark\b/i,
  /\bnovel\s+unit\b/i,
  /\bteacher.?s?\s+guide\b/i,
  /\blesson\s+plans?\b/i,
  /\bcurriculum\s+guide\b/i,
  /\bpodcast\b/i,
  /\bsupersummary\b/i,
  /\bbookhabits\b/i,
];

const JUNK_SEARCH_AUTHOR_PATTERNS =
  /^(supersummary|bookhabits|bookcaps|readtrepreneur|worth\s*books|bright\s*summaries|book\s*tigers|instaread|summary\s+station|unknown\s+author)$/i;

/** Returns true if a search result looks like a study guide, summary, podcast, or non-book */
function isJunkSearchResult(title: string, author?: string): boolean {
  if (JUNK_SEARCH_TITLE_PATTERNS.some(p => p.test(title))) return true;
  if (author && JUNK_SEARCH_AUTHOR_PATTERNS.test(author.trim())) return true;
  return false;
}

// ── Search ────────────────────────────────────────────

/**
 * Search Goodreads for books matching a query.
 * Returns up to 10 results with basic metadata.
 */
export async function searchGoodreads(
  query: string
): Promise<GoodreadsSearchResult[]> {
  if (isCircuitOpen()) {
    console.warn("[goodreads-search] Circuit breaker open — skipping request");
    return [];
  }

  await sleep(GOODREADS_DELAY_MS);

  const url = GOODREADS_SEARCH_URL + encodeURIComponent(query);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
  } catch (err) {
    console.warn("[goodreads-search] Fetch failed:", err);
    recordFailure();
    return [];
  }

  if (!res.ok) {
    console.warn(`[goodreads-search] HTTP ${res.status} for "${query}"`);
    recordFailure();
    return [];
  }

  recordSuccess();

  const html = await res.text();
  const $ = cheerio.load(html);

  const results: GoodreadsSearchResult[] = [];

  $("tr[itemtype='http://schema.org/Book']").each((i, row) => {
    if (i >= 10) return false; // limit to 10

    const $row = $(row);

    // Title + link
    const titleLink = $row.find("a.bookTitle");
    const title = titleLink.find("span[itemprop='name']").text().trim() || titleLink.text().trim();
    const href = titleLink.attr("href") ?? "";
    const goodreadsId = extractGoodreadsId(href);
    if (!goodreadsId || !title) return;

    const goodreadsUrl = `https://www.goodreads.com${href.split("?")[0]}`;

    // Author
    const author =
      $row.find("a.authorName span[itemprop='name']").first().text().trim() ||
      $row.find("a.authorName").first().text().trim();

    // Cover
    let coverUrl = $row.find("img.bookCover").attr("src") ?? null;
    if (coverUrl) {
      // Upgrade to larger image (replace _SX50_ or _SY75_ with _SX200_)
      coverUrl = coverUrl.replace(/_S[XY]\d+_/, "_SX200_");
    }

    // Rating
    const miniratingText = $row.find(".minirating").text();
    let rating: number | null = null;
    let ratingCount: number | null = null;

    const ratingMatch = miniratingText.match(/([\d.]+)\s*avg\s*rating/);
    if (ratingMatch) rating = parseFloat(ratingMatch[1]);

    const countMatch = miniratingText.match(/([\d,]+)\s*rating/);
    if (countMatch) ratingCount = parseInt(countMatch[1].replace(/,/g, ""), 10);

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

  // Filter out study guides, summaries, and box sets — keep only real books
  const filtered = results.filter(r => !isJunkSearchResult(r.title, r.author));

  // If filtering removed everything, return unfiltered (better than empty)
  return filtered.length > 0 ? filtered : results;
}

// ── Book detail ───────────────────────────────────────

/**
 * Get full metadata for a single book by its Goodreads ID.
 * Fetches the book page for genres, series info, description, etc.
 */
export async function getGoodreadsBookById(
  goodreadsId: string
): Promise<GoodreadsBookDetail | null> {
  if (isCircuitOpen()) {
    console.warn("[goodreads-detail] Circuit breaker open — skipping request");
    return null;
  }

  await sleep(GOODREADS_DELAY_MS);

  const url = `https://www.goodreads.com/book/show/${goodreadsId}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
  } catch (err) {
    console.warn(`[goodreads-detail] Fetch failed for ${goodreadsId}:`, err);
    recordFailure();
    return null;
  }

  if (!res.ok) {
    console.warn(`[goodreads-detail] HTTP ${res.status} for ${goodreadsId}`);
    recordFailure();
    return null;
  }

  recordSuccess();

  const html = await res.text();
  const $ = cheerio.load(html);

  // Title
  const title =
    $('h1[data-testid="bookTitle"]').text().trim() ||
    $("h1#bookTitle").text().trim() ||
    $("h1.Text__title1").text().trim();
  if (!title) return null;

  // Author
  const author =
    $('span[data-testid="name"]').first().text().trim() ||
    $("a.authorName span").first().text().trim() ||
    $(".ContributorLink__name").first().text().trim();

  // Cover
  let coverUrl =
    $('img.ResponsiveImage[src*="books"]').first().attr("src") ??
    $(".BookCover__image img").first().attr("src") ??
    null;
  if (coverUrl) {
    coverUrl = coverUrl.replace(/\._S[XY]\d+_/, "");
  }

  // Rating
  let rating: number | null = null;
  let ratingCount: number | null = null;

  const ratingText =
    $('[data-testid="averageRating"]').text().trim() ||
    $(".RatingStatistics__rating").text().trim();
  if (ratingText) rating = parseFloat(ratingText) || null;

  const ratingCountText =
    $('[data-testid="ratingsCount"]').text().trim() ||
    $(".RatingStatistics__count span").first().text().trim();
  const countMatch = ratingCountText.match(/([\d,]+)/);
  if (countMatch) ratingCount = parseInt(countMatch[1].replace(/,/g, ""), 10);

  // Genres
  const genres: string[] = [];
  $(
    '[data-testid="genresList"] .Button--tag, .BookPageMetadataSection__genreButton, a[href*="/genres/"]'
  ).each((_, el) => {
    const genre = $(el).text().trim().toLowerCase();
    if (genre && genre.length < 60 && !genres.includes(genre)) {
      genres.push(genre);
    }
  });

  // Description
  const description =
    $('[data-testid="description"] .Formatted').text().trim() ||
    $(".BookPageMetadataSection__description .Formatted").text().trim() ||
    $("#description span").last().text().trim() ||
    null;

  // Series
  let seriesName: string | null = null;
  let seriesPosition: number | null = null;

  const seriesText =
    $('h3[data-testid="bookSeries"] a').text().trim() ||
    $(".BookPageTitleSection__title a").text().trim();
  if (seriesText) {
    // Format: "(Series Name #2)" or "Series Name, #2"
    const seriesMatch = seriesText.match(/\(?\s*(.+?)\s*[#,]\s*(\d+)\s*\)?/);
    if (seriesMatch) {
      seriesName = seriesMatch[1].trim();
      seriesPosition = parseInt(seriesMatch[2], 10);
    } else {
      seriesName = seriesText.replace(/[()]/g, "").trim();
    }
  }

  // Published year
  let publishedYear: number | null = null;
  const pubText =
    $('[data-testid="publicationInfo"]').text().trim() ||
    $(".FeaturedDetails p").text();
  const yearMatch = pubText.match(/(\d{4})/);
  if (yearMatch) publishedYear = parseInt(yearMatch[1], 10);

  // Page count
  let pageCount: number | null = null;
  const pageText =
    $('[data-testid="pagesFormat"]').text().trim() ||
    $('[itemprop="numberOfPages"]').text().trim();
  const pageMatch = pageText.match(/(\d+)\s*page/i);
  if (pageMatch) pageCount = parseInt(pageMatch[1], 10);

  const goodreadsUrl = `https://www.goodreads.com/book/show/${goodreadsId}`;

  return {
    goodreadsId,
    goodreadsUrl,
    title,
    author: author || "Unknown Author",
    coverUrl,
    rating,
    ratingCount,
    description,
    genres,
    seriesName,
    seriesPosition,
    publishedYear,
    pageCount,
  };
}

// ── Edition selection ─────────────────────────────────

/**
 * From a set of search results, pick the canonical edition — the one with the
 * highest ratingCount among title/author matches. This avoids locking onto
 * obscure editions (audiobook, Kindle, foreign language) that have 1-50 ratings
 * instead of the work-level entry with millions.
 */
function pickCanonicalEdition(
  results: GoodreadsSearchResult[],
  title: string,
  author: string,
  titleThreshold: number
): string | null {
  let bestId: string | null = null;
  let bestCount = -1;

  for (const result of results) {
    const titleSim = wordOverlap(title, result.title);
    const authorMatch = normalize(author)
      .split(" ")
      .some((word) => normalize(result.author).includes(word));

    if (titleSim >= titleThreshold && authorMatch) {
      const count = result.ratingCount ?? 0;
      if (count > bestCount) {
        bestCount = count;
        bestId = result.goodreadsId;
      }
    }
  }

  return bestId;
}

// ── Resolution ────────────────────────────────────────

/**
 * Given a title and author (e.g. from NYT API), find the matching
 * Goodreads book and return its Goodreads ID.
 * Returns null if no confident match found.
 */
export async function resolveToGoodreadsId(
  title: string,
  author: string,
  options?: { fuzzy?: boolean }
): Promise<string | null> {
  // Fuzzy mode (used by video resolver) relaxes the word overlap threshold
  // to handle Whisper transcription errors like "Alchemized"→"Alchemised"
  const titleThreshold = options?.fuzzy ? 0.6 : 0.8;

  // Attempt 1: search with full title + author
  const results = await searchGoodreads(`${title} ${author}`);
  const best1 = pickCanonicalEdition(results.slice(0, 5), title, author, titleThreshold);
  if (best1) return best1;

  // Attempt 2: search with just the title
  const titleResults = await searchGoodreads(title);
  const best2 = pickCanonicalEdition(titleResults.slice(0, 5), title, author, titleThreshold);
  if (best2) return best2;

  console.warn(
    `[goodreads-search] Could not resolve "${title}" by "${author}" to a Goodreads ID`
  );
  return null;
}

// ── Romance genre check ──────────────────────────────

const ROMANCE_GENRE_TERMS = [
  "romance",
  "romantasy",
  "paranormal romance",
  "contemporary romance",
  "historical romance",
  "fantasy romance",
  "dark romance",
  "erotic romance",
  "romantic suspense",
  "romantic comedy",
  "new adult",
];

/**
 * Determine if a book is romance/romantasy based on its Goodreads genres.
 */
export function isRomanceBook(genres: string[]): boolean {
  for (const genre of genres) {
    const lower = genre.toLowerCase();
    if (ROMANCE_GENRE_TERMS.some((term) => lower.includes(term))) {
      return true;
    }
  }
  return false;
}

// ── Slug generation ───────────────────────────────────

/**
 * Generate a URL slug for a book.
 * Format: "slugified-title-goodreadsId"
 * e.g. "a-court-of-thorns-and-roses-17675462"
 */
export function generateBookSlug(
  title: string,
  goodreadsId: string | null
): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 60);

  return goodreadsId ? `${slug}-${goodreadsId}` : `${slug}-provisional-${Date.now()}`;
}

/**
 * Extract the Goodreads ID from a book slug.
 * e.g. "a-court-of-thorns-and-roses-17675462" → "17675462"
 */
export function extractGoodreadsIdFromSlug(slug: string): string | null {
  const match = slug.match(/-(\d+)$/);
  return match ? match[1] : null;
}
