/**
 * ROMANCE.IO SPICE VIA GOOGLE SEARCH INDEX
 *
 * romance.io blocks direct scraping, but Google has indexed their
 * book pages and surfaces spice data in search snippets.
 * We query Google (via Serper.dev) for romance.io results and
 * parse the spice level from the snippet text.
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
 * MEDIUM confidence (store, never display):
 *   - Author appears in snippet text but not confirmed in slug
 *   - OR title is in slug but author unconfirmed
 *
 * LOW confidence (discard):
 *   - Author not found anywhere in result
 *   - OR our books table has multiple titles matching this title
 *   - OR no romance.io URL in top results
 */

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
}

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
}

interface SerperResponse {
  organic?: SerperResult[];
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

/**
 * Parse spice/heat data from a search snippet.
 * Returns { spiceLevel, heatLabel } or null.
 */
function parseSpiceFromSnippet(
  snippet: string,
  resultTitle: string
): { spiceLevel: number; heatLabel: string } | null {
  const text = (snippet + " " + resultTitle).toLowerCase();

  // Pattern 1: "Spice/Steam/Heat level: X/5" or "X out of 5"
  const levelMatch = text.match(
    /(?:spice|steam|heat|spiciness)\s*(?:level|rating)?[:\s]*(\d(?:\.\d)?)\s*(?:\/\s*5|out\s*of\s*5)/i
  );
  if (levelMatch) {
    const raw = parseFloat(levelMatch[1]);
    const level = Math.min(5, Math.max(1, Math.round(raw)));

    // Also try to find a heat label
    const label = findHeatLabel(text);
    return {
      spiceLevel: level,
      heatLabel: label || spiceLevelToLabel(level),
    };
  }

  // Pattern 2: Look for heat label text
  const label = findHeatLabel(text);
  if (label) {
    return {
      spiceLevel: HEAT_LABEL_TO_LEVEL[label.toLowerCase()] ?? 3,
      heatLabel: label,
    };
  }

  // Pattern 3: "Rated X/5" (star rating, not spice — but sometimes
  // romance.io shows "Spice: X/5" in a compact format)
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

  return null;
}

/**
 * Find a known heat label in text.
 * Searches longest labels first to avoid partial matches.
 */
function findHeatLabel(text: string): string | null {
  // Sort by length descending to match "very explicit open door" before "open door"
  const labels = Object.keys(HEAT_LABEL_TO_LEVEL).sort(
    (a, b) => b.length - a.length
  );
  for (const label of labels) {
    if (text.includes(label)) {
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
 * Matches patterns like:
 *   "Rated 4.4/5"
 *   "Rated 4.4/5 stars"
 *   "Rating: 4.5"
 *   "4.3 / 5 stars"
 *   "4.3/5"
 */
function parseRomanceIoRating(snippet: string, resultTitle: string): number | null {
  const text = snippet + " " + resultTitle;

  // Pattern 1: "Rated X.X/5" or "Rated X.X/5 stars"
  const ratedMatch = text.match(/[Rr]ated\s+(\d\.\d)\s*\/\s*5/);
  if (ratedMatch) {
    const val = parseFloat(ratedMatch[1]);
    if (val >= 1 && val <= 5) return val;
  }

  // Pattern 2: "Rating: X.X" or "Rating X.X/5"
  const ratingMatch = text.match(/[Rr]ating[:\s]+(\d\.\d)\s*(?:\/\s*5)?/);
  if (ratingMatch) {
    const val = parseFloat(ratingMatch[1]);
    if (val >= 1 && val <= 5) return val;
  }

  // Pattern 3: standalone "X.X/5 stars" or "X.X / 5"
  const starsMatch = text.match(/(\d\.\d)\s*\/\s*5\s*(?:stars?)?/i);
  if (starsMatch) {
    const val = parseFloat(starsMatch[1]);
    if (val >= 1 && val <= 5) return val;
  }

  return null;
}

/**
 * Main function. Given a book's title and author, attempts to find
 * and return romance.io spice data via Google search index.
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
    const query = `romance.io rating "${title}" "${author}"`;
    const response = await fetch(SERPER_ENDPOINT, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        num: 5,
      }),
    });

    if (!response.ok) {
      console.warn(
        `[romance.io] Serper API error: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data: SerperResponse = await response.json();
    const results = data.organic ?? [];

    // Find the first romance.io book page result
    const romanceIoResult = results.find(
      (r) =>
        r.link.includes("romance.io/books/") ||
        r.link.includes("romance.io/book/")
    );

    if (!romanceIoResult) {
      console.log(`[romance.io] No romance.io result found for "${title}"`);
      return null;
    }

    // Step 3: Extract slug and score confidence
    const urlParts = romanceIoResult.link.split("/");
    const slug = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2];

    const titleWords = getTitleWords(title);

    // Check title words in slug
    const titleWordsInSlug = titleWords.filter((w) => slug.includes(w));
    const titleConfirmed =
      titleWords.length > 0 &&
      titleWordsInSlug.length >= Math.ceil(titleWords.length * 0.6);

    // Check author in slug or snippet
    const authorConfirmation = confirmAuthor(
      author,
      slug,
      romanceIoResult.snippet + " " + romanceIoResult.title
    );

    // Score confidence
    let confidence: "high" | "medium" | "low";
    if (titleConfirmed && authorConfirmation === "slug") {
      confidence = "high";
    } else if (titleConfirmed && authorConfirmation === "snippet") {
      confidence = "medium";
    } else if (authorConfirmation === "slug" && titleWordsInSlug.length > 0) {
      confidence = "medium";
    } else {
      confidence = "low";
    }

    console.log(
      `[romance.io] "${title}" → slug="${slug}" confidence=${confidence} ` +
        `(title: ${titleWordsInSlug.length}/${titleWords.length}, author: ${authorConfirmation})`
    );

    // LOW confidence — not worth storing
    if (confidence === "low") {
      return null;
    }

    // Step 4: Parse spice data from snippet
    const spiceData = parseSpiceFromSnippet(
      romanceIoResult.snippet,
      romanceIoResult.title
    );

    if (!spiceData) {
      console.log(
        `[romance.io] Found "${title}" on romance.io but couldn't parse spice data from snippet`
      );
      // Still return the result with a default — having the romance.io link
      // and slug is valuable even without parsed spice
      return {
        spiceLevel: 3, // default to moderate if we can't parse
        heatLabel: "Open Door",
        romanceIoSlug: slug,
        romanceIoUrl: romanceIoResult.link,
        romanceIoRating: parseRomanceIoRating(romanceIoResult.snippet, romanceIoResult.title),
        confidence,
      };
    }

    return {
      spiceLevel: spiceData.spiceLevel,
      heatLabel: spiceData.heatLabel,
      romanceIoSlug: slug,
      romanceIoUrl: romanceIoResult.link,
      romanceIoRating: parseRomanceIoRating(romanceIoResult.snippet, romanceIoResult.title),
      confidence,
    };
  } catch (err) {
    console.warn(`[romance.io] Error searching for "${title}":`, err);
    return null;
  }
}
