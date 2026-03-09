import * as cheerio from "cheerio";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface GoodreadsData {
  rating: number;
  ratingCount: number;
  goodreadsId: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function scrapeGoodreadsRating(
  bookTitle: string,
  author: string
): Promise<GoodreadsData | null> {
  try {
    // Respectful delay before scraping
    await sleep(1000 + Math.random() * 1000);

    const query = encodeURIComponent(`${bookTitle} ${author}`);
    const searchUrl = `https://www.goodreads.com/search?q=${query}`;

    const res = await fetch(searchUrl, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });

    if (!res.ok) {
      console.warn(`Goodreads search returned ${res.status} for "${bookTitle}"`);
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Find the first search result row
    const firstResult = $("tr[itemtype='http://schema.org/Book']").first();
    if (firstResult.length === 0) {
      // Try alternate selector for newer Goodreads layout
      const altResult = $(".bookTitle").first();
      if (altResult.length === 0) {
        console.warn(`No Goodreads results found for "${bookTitle}"`);
        return null;
      }
    }

    // Extract rating from the minirating span
    const miniratingText =
      firstResult.find(".minirating").text() ||
      $(".minirating").first().text();

    if (!miniratingText) return null;

    // Pattern: "4.23 avg rating — 1,234,567 ratings"
    const ratingMatch = miniratingText.match(/([\d.]+)\s*avg\s*rating/);
    const countMatch = miniratingText.match(/([\d,]+)\s*rating/);

    if (!ratingMatch) return null;

    const rating = parseFloat(ratingMatch[1]);
    const ratingCount = countMatch
      ? parseInt(countMatch[1].replace(/,/g, ""), 10)
      : 0;

    // Extract Goodreads ID from the book link
    const bookLink =
      firstResult.find("a.bookTitle").attr("href") ||
      $("a.bookTitle").first().attr("href") ||
      "";
    const idMatch = bookLink.match(/\/show\/(\d+)/);
    const goodreadsId = idMatch ? idMatch[1] : "";

    if (!rating || isNaN(rating)) return null;

    return { rating, ratingCount, goodreadsId };
  } catch (err) {
    console.warn(`Goodreads scraping failed for "${bookTitle}":`, err);
    return null;
  }
}
