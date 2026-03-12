/**
 * Amazon rating lookup via Serper (Google Search API).
 *
 * Replaces direct Amazon scraping which returns 503 errors.
 * Uses the same SERPER_API_KEY as the romance.io spice lookup.
 * Cost: ~$0.001 per query.
 */

export interface AmazonData {
  rating: number;
  ratingCount: number;
  asin: string;
}

export async function getAmazonRatingViaSerper(
  title: string,
  author: string,
  isbn?: string | null
): Promise<AmazonData | null> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn("[amazon-search] SERPER_API_KEY not set, skipping");
    return null;
  }

  try {
    // Build query: ISBN is most precise, fallback to title + author
    const query = isbn
      ? `site:amazon.com "${isbn}"`
      : `site:amazon.com "${title}" ${author} book`;

    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        num: 5,
        gl: "us",
      }),
    });

    if (!res.ok) {
      console.warn(`[amazon-search] Serper returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    const results: SerperResult[] = data.organic ?? [];

    for (const result of results) {
      // Must be an Amazon product page
      const asinMatch = result.link?.match(
        /amazon\.com(?:\/[^/]+)?\/dp\/([A-Z0-9]{10})/
      );
      if (!asinMatch) continue;

      const asin = asinMatch[1];

      // Extract rating from snippet — Google shows "4.6 out of 5 stars" or "Rating: 4.6 out of 5"
      const ratingMatch = result.snippet?.match(
        /(\d+(?:\.\d+)?)\s*out\s*of\s*5\s*stars?/i
      );
      if (!ratingMatch) continue;

      const rating = parseFloat(ratingMatch[1]);
      if (rating < 1 || rating > 5) continue;

      // Extract rating count — "12,345 ratings" or "1,234 reviews"
      let ratingCount = 0;
      const countMatch = result.snippet?.match(
        /([\d,]+)\s*(?:ratings?|reviews?|global ratings?)/i
      );
      if (countMatch) {
        ratingCount = parseInt(countMatch[1].replace(/,/g, ""), 10);
      }

      // Also check the title for rating info (Google sometimes puts it there)
      if (!ratingCount && result.title) {
        const titleCountMatch = result.title.match(
          /([\d,]+)\s*(?:ratings?|reviews?)/i
        );
        if (titleCountMatch) {
          ratingCount = parseInt(titleCountMatch[1].replace(/,/g, ""), 10);
        }
      }

      return { rating, ratingCount, asin };
    }

    // No Amazon product page with rating found
    return null;
  } catch (err) {
    console.warn("[amazon-search] Failed:", err);
    return null;
  }
}

interface SerperResult {
  title?: string;
  link?: string;
  snippet?: string;
}
