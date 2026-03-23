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

    // Scan ALL search results (up to 10) and pick the canonical edition —
    // the one with the highest ratingCount. This prevents locking onto
    // obscure editions (audiobook, Kindle, foreign) with 1-50 ratings.
    interface Candidate {
      rating: number;
      ratingCount: number;
      goodreadsId: string;
    }

    let best: Candidate | null = null;

    $("tr[itemtype='http://schema.org/Book']").each((i, row) => {
      if (i >= 10) return false;

      const $row = $(row);
      const miniratingText = $row.find(".minirating").text();
      if (!miniratingText) return;

      const ratingMatch = miniratingText.match(/([\d.]+)\s*avg\s*rating/);
      const countMatch = miniratingText.match(/([\d,]+)\s*rating/);
      if (!ratingMatch) return;

      const rating = parseFloat(ratingMatch[1]);
      const ratingCount = countMatch
        ? parseInt(countMatch[1].replace(/,/g, ""), 10)
        : 0;

      if (isNaN(rating) || !rating) return;

      // Skip edition-level ratings (< 50 ratings = not the canonical work)
      if (ratingCount < 50) return;

      const bookLink = $row.find("a.bookTitle").attr("href") ?? "";
      const idMatch = bookLink.match(/\/show\/(\d+)/);
      if (!idMatch) return;

      // Pick the edition with the most ratings (canonical edition)
      if (!best || ratingCount > best.ratingCount) {
        best = { rating, ratingCount, goodreadsId: idMatch[1] };
      }
    });

    if (!best) {
      console.warn(`[goodreads] No canonical edition found for "${bookTitle}" (all results had < 50 ratings)`);
      return null;
    }

    return best;
  } catch (err) {
    console.warn(`Goodreads scraping failed for "${bookTitle}":`, err);
    return null;
  }
}
