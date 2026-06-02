/**
 * ROMANCE.IO SPICE VIA GOOGLE SEARCH INDEX
 *
 * romance.io blocks direct scraping, but Google has indexed their
 * book pages and surfaces spice data in search snippets.
 * We query Google (via Serper.dev) for romance.io results and
 * parse the spice level from the snippet text + Serper structured data.
 *
 * This reads publicly available Google search results — we are not
 * hitting romance.io's servers. We display 'romance.io' as the
 * source with a direct link back to their page, sending them traffic.
 *
 * CONFIDENCE SCORING
 * We only display spice data we're confident about.
 * False matches (e.g. two books with the title "The Deal") are
 * worse than no data — so we'd rather show nothing than show wrong data.
 *
 * HIGH confidence (store + display):
 *   - romance.io URL slug contains slugified author last name
 *   - AND slug contains slugified title words
 *
 * MEDIUM confidence (store + display):
 *   - Author appears in snippet text but not confirmed in slug
 *   - OR title is in slug but author unconfirmed
 *
 * LOW confidence (discard):
 *   - Author not found anywhere in result
 *   - OR our books table has multiple titles matching this title
 *   - OR no romance.io URL in top results
 */

import { extractTagsFromSnippet } from "./romance-io-tags";
import { shouldSkipQuery, cacheResult } from "./serper-cache";

const SERPER_ENDPOINT = "https://google.serper.dev/search";

// romance.io heat level labels mapped to numeric spice levels
const HEAT_LABEL_TO_LEVEL: Record<string, number> = {
  "no sex": 1,
  "glimpses and kisses": 1,
  "behind closed doors": 2,
  "fade to black": 2,
  "open door": 3,
  "explicit open door": 4,
  "very explicit open door": 5,
  "explicit": 4,
  "very explicit": 5,
};

// Common words to strip from titles when building slug-match terms
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "in",
  "to",
  "for",
  "is",
  "on",
  "at",
  "by",
]);

export interface RomanceIoSpiceResult {
  spiceLevel: number;
  heatLabel: string;
  romanceIoSlug: string;
  romanceIoUrl: string;
  romanceIoRating: number | null;
  confidence: "high" | "medium" | "low";
  /** Raw tags extracted from the "tagged as ..." snippet section */
  rawTags: string[];
}

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  rating?: number;
  ratingCount?: number;
  position?: number;
}

interface SerperResponse {
  organic?: SerperResult[];
}

async function searchSerper(
  apiKey: string,
  query: string,
  num = 5
): Promise<SerperResult[]> {
  const response = await fetch(SERPER_ENDPOINT, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num }),
  });

  if (!response.ok) {
    const message = await getSerperErrorMessage(response);
    console.warn(`[romance.io] Serper API error: ${response.status} ${message}`);
    if (isSerperProviderUnavailable(response.status, message)) {
      throw new Error(`rate limit: Serper unavailable for romance.io lookup (${message})`);
    }
    return [];
  }

  const data: SerperResponse = await response.json();
  return (data.organic ?? []).filter((result) => result.link.includes("romance.io/"));
}

/**
 * Slugify a string for comparison.
 * Lowercase, remove punctuation, replace spaces with hyphens.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "") // remove apostrophes
    .replace(/[^a-z0-9\s-]/g, "") // remove non-alphanumeric
    .replace(/\s+/g, "-") // spaces to hyphens
    .replace(/-+/g, "-") // collapse hyphens
    .trim();
}

/**
 * Extract the last name from an author string.
 * "Rebecca Yarros" → "yarros"
 * "J.R. Ward" → "ward"
 */
function getAuthorLastName(author: string): string {
  const parts = author.trim().split(/\s+/);
  return slugify(parts[parts.length - 1]);
}

/**
 * Get significant title words for slug matching.
 * "Fourth Wing" → ["fourth", "wing"]
 * "The Sweet Spot" → ["sweet", "spot"]
 */
function getTitleWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Check if author name is confirmed in the search result.
 * Checks both the URL slug and the snippet text.
 */
function confirmAuthor(
  authorName: string,
  slug: string,
  snippetText: string
): "slug" | "snippet" | false {
  const lastName = getAuthorLastName(authorName);
  if (!lastName) return false;

  // Best: author last name in the URL slug
  if (slug.includes(lastName)) return "slug";

  // OK: author name appears in the snippet text
  const lowerSnippet = snippetText.toLowerCase();
  if (lowerSnippet.includes(authorName.toLowerCase())) return "snippet";
  if (lowerSnippet.includes(lastName)) return "snippet";

  return false;
}

function resultMatchesBookContext(result: SerperResult, title: string, author: string): boolean {
  const haystack = `${result.title} ${result.snippet} ${decodeURIComponent(result.link)}`.toLowerCase();
  const titleWords = getTitleWords(title);
  const matchedTitleWords = titleWords.filter((word) => haystack.includes(word)).length;
  const titleMatches =
    titleWords.length > 0 &&
    matchedTitleWords >= Math.max(1, Math.ceil(titleWords.length * 0.6));
  const authorMatches = Boolean(confirmAuthor(author, result.link, haystack));

  return titleMatches && authorMatches;
}

function bookSlugFromUrl(link: string): string | null {
  const match = link.match(/romance\.io\/books\/([^/?#]+\/[^/?#]+)/);
  return match ? match[1] : null;
}

function isSimilarPage(link: string): boolean {
  return /\/similar(?:[/?#]|$)/.test(link);
}

function slugConfirmsBook(link: string, title: string, author: string): boolean {
  const bookSlug = bookSlugFromUrl(link);
  if (!bookSlug) return false;

  const slug = bookSlug.toLowerCase();
  const titleWords = getTitleWords(title);
  const matchedTitleWords = titleWords.filter((word) => slug.includes(word)).length;
  const titleConfirmed =
    titleWords.length > 0 &&
    matchedTitleWords >= Math.max(1, Math.ceil(titleWords.length * 0.6));
  const authorConfirmed = confirmAuthor(author, slug, "");

  return titleConfirmed && Boolean(authorConfirmed);
}

function snippetSegmentForBook(result: SerperResult, title: string, author: string): string | null {
  if (isSimilarPage(result.link)) return null;

  const isBookPage =
    result.link.includes("romance.io/books/") || result.link.includes("romance.io/book/");
  const slugMatchesTarget = slugConfirmsBook(result.link, title, author);
  if (isBookPage && !slugMatchesTarget) return null;

  // Exact book pages can safely use the title + snippet.
  if (slugMatchesTarget) {
    return `${result.title} ${result.snippet}`;
  }

  const segments = result.snippet
    .split(/\s+[;|]\s+|\s+·\s+·\s+|\n+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const titleWords = getTitleWords(title);
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    const matchedTitleWords = titleWords.filter((word) => lower.includes(word)).length;
    const titleMatches =
      titleWords.length > 0 &&
      matchedTitleWords >= Math.max(1, Math.ceil(titleWords.length * 0.6));
    const authorMatches = Boolean(confirmAuthor(author, "", segment));

    if (titleMatches && authorMatches) return segment;
  }

  return null;
}

function collectRomanceIoSignals(
  results: SerperResult[],
  title: string,
  author: string,
  current: {
    bestSpice: { spiceLevel: number; heatLabel: string } | null;
    bestRating: number | null;
    allTags: string[];
  }
) {
  for (const result of results) {
    if (isSimilarPage(result.link)) continue;
    if (!resultMatchesBookContext(result, title, author)) continue;
    const scopedSnippet = snippetSegmentForBook(result, title, author);
    if (!scopedSnippet) continue;

    // Try Serper's structured rating field first (most reliable)
    if (
      !current.bestRating &&
      slugConfirmsBook(result.link, title, author) &&
      !isSimilarPage(result.link) &&
      result.rating &&
      result.rating >= 1 &&
      result.rating <= 5
    ) {
      current.bestRating = Math.round(result.rating * 100) / 100;
    }

    // Parse snippet for spice data
    if (!current.bestSpice) {
      const spice = parseSpiceFromSnippet(scopedSnippet, "");
      if (spice) current.bestSpice = spice;
    }

    // Parse snippet for rating (in case Serper structured data is missing)
    if (!current.bestRating) {
      const rating = parseRomanceIoRating(scopedSnippet, "");
      if (rating) current.bestRating = rating;
    }

    // Extract tags from "tagged as ..." section
    const snippetTags = extractTagsFromSnippet(scopedSnippet);
    if (snippetTags.length > 0) {
      for (const tag of snippetTags) {
        if (!current.allTags.includes(tag)) current.allTags.push(tag);
      }
    }
  }
}

/**
 * Parse spice/heat data from a search snippet.
 *
 * Real romance.io snippet formats observed from Serper:
 *   - "Steam rating: 3 of 5 - Open door" (series/author pages)
 *   - "Steam rating: 4 of 5 - Explicit open door"
 *   - "Steam rating: 4 of 5" (without label)
 *   - "Spice/Steam/Heat level: X/5" (rare, older format)
 *
 * Returns { spiceLevel, heatLabel } or null.
 */
function parseSpiceFromSnippet(
  snippet: string,
  resultTitle: string
): { spiceLevel: number; heatLabel: string } | null {
  const text = (snippet + " " + resultTitle).toLowerCase();

  // Pattern 1: "Steam rating: X of 5 - Label" (most common romance.io format)
  const steamOfMatch = text.match(
    /(?:steam|spice|heat)\s*rating[:\s]*(\d)\s*(?:of|\/)\s*5(?:\s*[-–—]\s*(.+?)(?:\s*·|\s*$))?/i
  );
  if (steamOfMatch) {
    const level = Math.min(5, Math.max(1, parseInt(steamOfMatch[1])));
    const labelText = steamOfMatch[2]?.trim();
    const label = labelText ? findHeatLabel(labelText) || findHeatLabel(text) : findHeatLabel(text);
    return {
      spiceLevel: level,
      heatLabel: label || spiceLevelToLabel(level),
    };
  }

  // Pattern 2: "Spice/Steam/Heat level: X/5" or "X out of 5"
  const levelMatch = text.match(
    /(?:spice|steam|heat|spiciness)\s*(?:level|rating)?[:\s]*(\d(?:\.\d)?)\s*(?:\/\s*5|out\s*of\s*5)/i
  );
  if (levelMatch) {
    const raw = parseFloat(levelMatch[1]);
    const level = Math.min(5, Math.max(1, Math.round(raw)));
    const label = findHeatLabel(text);
    return {
      spiceLevel: level,
      heatLabel: label || spiceLevelToLabel(level),
    };
  }

  // Pattern 3: "Spice: X/5" compact format
  const ratedMatch = text.match(
    /(?:spice|steam)\s*:\s*(\d(?:\.\d)?)\s*\/\s*5/i
  );
  if (ratedMatch) {
    const raw = parseFloat(ratedMatch[1]);
    const level = Math.min(5, Math.max(1, Math.round(raw)));
    return {
      spiceLevel: level,
      heatLabel: spiceLevelToLabel(level),
    };
  }

  // Pattern 4: Look for heat label text alone (e.g. "explicit open door" in snippet)
  const label = findHeatLabel(text);
  if (label) {
    return {
      spiceLevel: HEAT_LABEL_TO_LEVEL[label.toLowerCase()] ?? 3,
      heatLabel: label,
    };
  }

  return null;
}

/**
 * Find a known heat label in text.
 * Searches longest labels first to avoid partial matches.
 */
function findHeatLabel(text: string): string | null {
  const lower = text.toLowerCase();
  // Sort by length descending to match "very explicit open door" before "open door"
  const labels = Object.keys(HEAT_LABEL_TO_LEVEL).sort(
    (a, b) => b.length - a.length
  );
  for (const label of labels) {
    if (lower.includes(label)) {
      // Return the label in title case
      return label
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
  }
  return null;
}

/**
 * Map a numeric spice level to a descriptive label.
 */
function spiceLevelToLabel(level: number): string {
  switch (level) {
    case 1:
      return "Sweet / Clean";
    case 2:
      return "Behind Closed Doors";
    case 3:
      return "Open Door";
    case 4:
      return "Explicit Open Door";
    case 5:
      return "Very Explicit Open Door";
    default:
      return "Open Door";
  }
}

/**
 * Extract romance.io star rating from snippet if present.
 *
 * Real romance.io snippet formats observed from Serper:
 *   - "Rated: 4.12 of 5 stars" (series/author pages)
 *   - "4.33 · 4982 ratings" (book pages)
 *   - "Rated: 4.41 of 5 stars · 2523 ratings"
 *   - "3.77 · ..." (bare rating at start)
 */
function parseRomanceIoRating(snippet: string, resultTitle: string): number | null {
  const text = snippet + " " + resultTitle;

  // Pattern 1: "Rated: X.XX of 5 stars" (most common on series/author pages)
  const ratedOfMatch = text.match(/[Rr]ated:?\s+(\d\.\d\d?)\s+of\s+5\s*(?:stars?)?/);
  if (ratedOfMatch) {
    const val = parseFloat(ratedOfMatch[1]);
    if (val >= 1 && val <= 5) return Math.round(val * 100) / 100;
  }

  // Pattern 2: "X.XX · NNNN ratings" (book pages — rating before middot)
  const middotMatch = text.match(/(\d\.\d\d?)\s*·\s*\d+\s*ratings?/);
  if (middotMatch) {
    const val = parseFloat(middotMatch[1]);
    if (val >= 1 && val <= 5) return Math.round(val * 100) / 100;
  }

  // Pattern 3: "Rated X.X/5" or "Rated X.X/5 stars" (legacy format)
  const ratedSlashMatch = text.match(/[Rr]ated\s+(\d\.\d\d?)\s*\/\s*5/);
  if (ratedSlashMatch) {
    const val = parseFloat(ratedSlashMatch[1]);
    if (val >= 1 && val <= 5) return Math.round(val * 100) / 100;
  }

  // Pattern 4: "Rating: X.X" or "Rating X.X/5"
  const ratingMatch = text.match(/[Rr]ating[:\s]+(\d\.\d\d?)\s*(?:\/\s*5)?/);
  if (ratingMatch) {
    const val = parseFloat(ratingMatch[1]);
    if (val >= 1 && val <= 5) return Math.round(val * 100) / 100;
  }

  // Pattern 5: standalone "X.X/5 stars" or "X.X / 5"
  const starsMatch = text.match(/(\d\.\d\d?)\s*\/\s*5\s*(?:stars?)?/i);
  if (starsMatch) {
    const val = parseFloat(starsMatch[1]);
    if (val >= 1 && val <= 5) return Math.round(val * 100) / 100;
  }

  return null;
}

/**
 * Main function. Given a book's title and author, attempts to find
 * and return romance.io spice data via Google search index.
 *
 * Searches ALL romance.io results (book pages, series pages, author pages)
 * and aggregates the best data from any of them.
 *
 * Returns null if no confident match found or API fails.
 */
export async function getRomanceIoSpice(
  title: string,
  author: string,
  existingTitleCount?: number
): Promise<RomanceIoSpiceResult | null> {
  try {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      console.warn("[romance.io] SERPER_API_KEY is not set — romance.io spice lookups are disabled. Add the key to your environment variables.");
      return null;
    }

    console.log(`[romance.io] Looking up spice for "${title}" by "${author}"`);

    // Step 1: Ambiguous title check
    if (existingTitleCount && existingTitleCount > 1) {
      console.log(
        `[romance.io] Skipping "${title}" — ${existingTitleCount} books share this title`
      );
      return null;
    }

    // Step 2: Query Serper for romance.io results
    // "tagged as" forces Google to anchor the snippet on the tag list section,
    // which also includes rating + spice level. Much higher tag extraction rate
    // than just "tagged". Author omitted — title + site: is enough for matching.
    const query = `site:romance.io "${title}" "tagged as"`;

    // Check Serper cache — skip if this query has returned no data 3+ times
    if (await shouldSkipQuery(query)) {
      console.log(`[romance.io] Skipping "${title}" — persistent cache miss (3+ no-data results)`);
      return null;
    }

    // Filter to romance.io results only (books, series, authors pages)
    let romanceIoResults = await searchSerper(apiKey, query, 5);

    // Fallback: if "tagged" query misses, try the original query format
    if (romanceIoResults.length === 0) {
      const fallbackQuery = `romance.io rating "${title}" "${author}"`;
      romanceIoResults = await searchSerper(apiKey, fallbackQuery, 5);
    }

    if (romanceIoResults.length === 0) {
      console.log(`[romance.io] No romance.io result found for "${title}"`);
      await cacheResult(query, "no_data");
      return null;
    }

    // Step 3: Find the best book page result for URL/slug/confidence
    // Prefer /books/ URLs, but accept /series/ and /authors/ for data
    const bookPageResult = romanceIoResults.find(
      (r) =>
        (r.link.includes("romance.io/books/") ||
          r.link.includes("romance.io/book/")) &&
        !isSimilarPage(r.link) &&
        slugConfirmsBook(r.link, title, author)
    );

    const primaryResult = bookPageResult || romanceIoResults[0];

    // Extract the path after /books/ (id + slug, e.g. "67d.../title-author").
    const cleanSlug = bookSlugFromUrl(primaryResult.link) ??
      (primaryResult.link.split("/").pop() || "").split("?")[0];

    const titleWords = getTitleWords(title);

    // Check title words in slug
    const titleWordsInSlug = titleWords.filter((w) => cleanSlug.includes(w));
    const titleConfirmed =
      titleWords.length > 0 &&
      titleWordsInSlug.length >= Math.ceil(titleWords.length * 0.6);

    // Combine all snippet text for author confirmation
    const allSnippetText = romanceIoResults
      .map((r) => r.snippet + " " + r.title)
      .join(" ");

    // Check author in slug or snippet (check all results)
    const authorConfirmation = confirmAuthor(author, cleanSlug, allSnippetText);

    // Score confidence
    let confidence: "high" | "medium" | "low";
    if (titleConfirmed && authorConfirmation === "slug") {
      confidence = "high";
    } else if (titleConfirmed && authorConfirmation === "snippet") {
      confidence = "high"; // Promoted: author in snippet + title in slug is reliable enough
    } else if (authorConfirmation === "slug" && titleWordsInSlug.length > 0) {
      confidence = "medium";
    } else if (authorConfirmation && titleWordsInSlug.length > 0) {
      confidence = "medium";
    } else {
      confidence = "low";
    }

    console.log(
      `[romance.io] "${title}" → slug="${cleanSlug}" confidence=${confidence} ` +
        `(title: ${titleWordsInSlug.length}/${titleWords.length}, author: ${authorConfirmation})`
    );

    // LOW confidence — not worth storing
    if (confidence === "low") {
      await cacheResult(query, "no_data");
      return null;
    }

    // Step 4: Extract data from ALL romance.io results
    // Aggregate spice and rating from any result that has them

    const signals = {
      bestSpice: null as { spiceLevel: number; heatLabel: string } | null,
      bestRating: null as number | null,
      allTags: [] as string[],
    };

    collectRomanceIoSignals(romanceIoResults, title, author, signals);

    // Step 5: If we found spice/tags but no rating, run a rating-targeted query.
    // The "tagged as" query anchors snippets on the tag section (lower on the page),
    // which reliably contains spice + heat label but often cuts off the star rating
    // that lives higher up. This second query anchors on the rating section instead.
    // Only fires when we already confirmed a match — costs ~$0.001 per extra call.
    if (!signals.bestRating) {
      try {
        const ratingQuery = `site:romance.io "${title}" "of 5 stars"`;
        const ratingResults = await searchSerper(apiKey, ratingQuery, 3);
        collectRomanceIoSignals(ratingResults, title, author, signals);

        if (signals.bestRating) {
          console.log(`[romance.io] "${title}" → rating=${signals.bestRating} (from rating-targeted query)`);
        }
      } catch (err) {
        console.warn(`[romance.io] Rating follow-up query failed for "${title}":`, err);
        if (err instanceof Error && err.message.startsWith("rate limit:")) {
          throw err;
        }
      }
    }

    // Step 6: If rating exists but spice was truncated, run spice-targeted
    // follow-ups. This is the missing half of the old two-query strategy:
    // Google may expose the rating section while cutting off "Steam rating".
    if (!signals.bestSpice) {
      const spiceQueries = [
        `site:romance.io "${title}" "${author}" "Steam rating:"`,
        `site:romance.io "${title}" "Steam rating:"`,
        `site:romance.io "${title}" "${author}" "Explicit open door"`,
        `site:romance.io "${title}" "${author}" "Explicit and plentiful"`,
      ];

      for (const spiceQuery of spiceQueries) {
        try {
          const spiceResults = await searchSerper(apiKey, spiceQuery, 5);
          collectRomanceIoSignals(spiceResults, title, author, signals);
          const foundSpice = signals.bestSpice as { spiceLevel: number; heatLabel: string } | null;
          if (foundSpice) {
            console.log(
              `[romance.io] "${title}" → spice=${foundSpice.spiceLevel} ` +
                `(${foundSpice.heatLabel}) from spice-targeted query`
            );
            break;
          }
        } catch (err) {
          console.warn(`[romance.io] Spice follow-up query failed for "${title}":`, err);
          if (err instanceof Error && err.message.startsWith("rate limit:")) {
            throw err;
          }
        }
      }
    }

    // Only store a slug from confirmed /books/ URLs — slugs from /series/ or
    // /authors/ pages produce broken links when we reconstruct the URL.
    // Capture full path after /books/ (id + slug) since romance.io requires both.
    const bestSlug = bookPageResult ? bookSlugFromUrl(bookPageResult.link) ?? "" : "";
    const bestUrl = bestSlug
      ? `https://www.romance.io/books/${bestSlug}`
      : `https://www.romance.io/search?q=${encodeURIComponent(`${title} ${author}`)}`;

    if (!signals.bestSpice) {
      console.log(
        `[romance.io] Found "${title}" on romance.io but couldn't parse spice from any snippet`
      );
      await cacheResult(query, "no_data");
      return null;
    }

    console.log(
      `[romance.io] "${title}" → spice=${signals.bestSpice.spiceLevel} (${signals.bestSpice.heatLabel}), rating=${signals.bestRating ?? "none"}, tags=${signals.allTags.length}`
    );

    await cacheResult(query, "hit");
    return {
      spiceLevel: signals.bestSpice.spiceLevel,
      heatLabel: signals.bestSpice.heatLabel,
      romanceIoSlug: bestSlug,
      romanceIoUrl: bestUrl,
      romanceIoRating: signals.bestRating,
      confidence,
      rawTags: signals.allTags,
    };
  } catch (err) {
    console.warn(`[romance.io] Error searching for "${title}":`, err);
    if (err instanceof Error && err.message.startsWith("rate limit:")) {
      throw err;
    }
    return null;
  }
}

async function getSerperErrorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : response.statusText;
  } catch {
    return body.trim() || response.statusText;
  }
}

function isSerperProviderUnavailable(status: number, message: string): boolean {
  const lower = message.toLowerCase();
  return (
    status === 429 ||
    lower.includes("not enough credits") ||
    lower.includes("quota") ||
    lower.includes("rate limit")
  );
}
