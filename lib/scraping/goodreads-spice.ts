import * as cheerio from "cheerio";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Shelf names that signal heat (matched as substrings, case-insensitive)
const SPICY_SHELVES = [
  "spicy", "steamy", "hot", "erotic", "explicit", "smut", "adult",
  "sexy", "sensual", "heat", "spice", "18+", "mature", "naughty",
  "dirty", "filthy", "dark-romance",
];

// Shelf names that signal low heat
const CLEAN_SHELVES = [
  "clean", "sweet", "wholesome", "no-spice", "sweet-romance",
  "christian-romance", "inspirational", "cozy", "fade-to-black",
  "closed-door",
];

export interface SpiceInference {
  spiceLevel: number;
  confidence: "low" | "medium" | "high";
  source: "goodreads_inference";
  shelfCount: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Infer spice level from Goodreads community shelves.
 * Readers shelve books with names like "spicy", "steamy", "clean-romance", etc.
 * By counting spicy vs. clean shelf mentions, we get a rough heat signal.
 */
export async function inferSpiceFromGoodreadsShelves(
  goodreadsId: string,
  title: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  author: string
): Promise<SpiceInference | null> {
  try {
    await sleep(1000 + Math.random() * 1000);

    // Fetch the book's Goodreads page
    const url = `https://www.goodreads.com/book/show/${goodreadsId}`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });

    if (!res.ok) {
      console.warn(`Goodreads spice: got ${res.status} for "${title}"`);
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Collect all shelf/genre text from the page
    const shelfTexts: string[] = [];

    // Goodreads shows genres/shelves in various elements
    $('[class*="genre"], [class*="shelf"], [class*="tag"], a[href*="/genres/"], a[href*="/shelf/"]').each((_, el) => {
      const text = $(el).text().trim().toLowerCase();
      if (text && text.length < 60) {
        shelfTexts.push(text);
      }
    });

    // Also check the "top shelves" section specifically
    $(".shelfStat, .left .mediumText a, .elementList .left a").each((_, el) => {
      const text = $(el).text().trim().toLowerCase();
      if (text && text.length < 60) {
        shelfTexts.push(text);
      }
    });

    if (shelfTexts.length === 0) {
      console.warn(`Goodreads spice: no shelves found for "${title}"`);
      return null;
    }

    // Count spicy vs clean mentions
    let spicyCount = 0;
    let cleanCount = 0;

    for (const shelf of shelfTexts) {
      if (SPICY_SHELVES.some((s) => shelf.includes(s))) {
        spicyCount++;
      }
      if (CLEAN_SHELVES.some((s) => shelf.includes(s))) {
        cleanCount++;
      }
    }

    const total = spicyCount + cleanCount;

    // Not enough signal
    if (total < 3) return null;

    const spicyRatio = spicyCount / total;

    // Map ratio to 1-5 scale
    let spiceLevel: number;
    if (spicyRatio < 0.15) spiceLevel = 1;       // sweet
    else if (spicyRatio < 0.35) spiceLevel = 2;   // mild
    else if (spicyRatio < 0.60) spiceLevel = 3;   // moderate
    else if (spicyRatio < 0.80) spiceLevel = 4;   // spicy
    else spiceLevel = 5;                           // very spicy

    // Determine confidence
    let confidence: "low" | "medium" | "high";
    if (total < 10) confidence = "low";
    else if (total <= 50) confidence = "medium";
    else confidence = "high";

    return {
      spiceLevel,
      confidence,
      source: "goodreads_inference",
      shelfCount: total,
    };
  } catch (err) {
    console.warn(`Goodreads spice inference failed for "${title}":`, err);
    return null;
  }
}
