/**
 * @deprecated Direct Amazon scraping returns 503 errors.
 * Use `amazon-search.ts` (Serper-based Google search) instead.
 * This file is kept for reference only.
 */

import * as cheerio from "cheerio";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface AmazonData {
  rating: number;
  ratingCount: number;
  asin: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function scrapeAmazonRating(
  isbn: string | null,
  asin?: string | null,
  title?: string | null,
  author?: string | null
): Promise<AmazonData | null> {
  try {
    // Respectful delay
    await sleep(1500 + Math.random() * 1500);

    let url: string;
    if (asin) {
      url = `https://www.amazon.com/dp/${asin}`;
    } else if (isbn) {
      url = `https://www.amazon.com/s?k=${isbn}`;
    } else if (title && author) {
      // Fallback: search by title + author in Books category
      url = `https://www.amazon.com/s?k=${encodeURIComponent(title + " " + author)}&i=stripbooks`;
    } else {
      return null;
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      console.warn(`Amazon returned ${res.status} for ISBN ${isbn}`);
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    let rating: number | null = null;
    let ratingCount: number | null = null;
    let extractedAsin = asin || null;

    if (asin) {
      // Product page: extract rating directly
      const ratingText =
        $("#acrPopover .a-size-base").first().text().trim() ||
        $('[data-action="acrStars498-popover"] .a-size-base').first().text().trim() ||
        $(".a-icon-alt").first().text().trim();

      const ratingMatch = ratingText.match(/([\d.]+)\s*out\s*of\s*5/);
      if (ratingMatch) {
        rating = parseFloat(ratingMatch[1]);
      }

      const countText =
        $("#acrCustomerReviewText").first().text().trim() ||
        $('[data-action="acrStarsLink-click-metrics"] .a-size-base').first().text().trim();

      const countMatch = countText.match(/([\d,]+)/);
      if (countMatch) {
        ratingCount = parseInt(countMatch[1].replace(/,/g, ""), 10);
      }
    } else {
      // Search results page: extract from first result
      const firstResult = $('[data-component-type="s-search-result"]').first();

      const ratingSpan = firstResult.find(".a-icon-alt").first().text();
      const ratingMatch = ratingSpan.match(/([\d.]+)\s*out\s*of\s*5/);
      if (ratingMatch) {
        rating = parseFloat(ratingMatch[1]);
      }

      // Look for the global ratings count link (e.g. "284,408" next to stars)
      // Amazon search results show this as a link with aria-label containing "ratings"
      const ratingsLink = firstResult.find('a[href*="customerReviews"], a[aria-label*="rating"]');
      let foundCount = false;
      ratingsLink.each((_, el) => {
        if (foundCount) return;
        const text = $(el).text().trim();
        const match = text.match(/([\d,]+)/);
        if (match) {
          const parsed = parseInt(match[1].replace(/,/g, ""), 10);
          if (parsed >= 10) {
            ratingCount = parsed;
            foundCount = true;
          }
        }
      });

      // Fallback: try the underline text span
      if (!foundCount) {
        const countSpan = firstResult
          .find('[class*="s-underline-text"]')
          .first()
          .text();
        const countMatch = countSpan.match(/([\d,]+)/);
        if (countMatch) {
          ratingCount = parseInt(countMatch[1].replace(/,/g, ""), 10);
        }
      }

      // Extract ASIN from the result link
      const resultLink = firstResult.find("a.a-link-normal[href*='/dp/']").attr("href");
      const asinMatch = resultLink?.match(/\/dp\/([A-Z0-9]{10})/);
      if (asinMatch) {
        extractedAsin = asinMatch[1];
      }
    }

    if (!rating || isNaN(rating) || !extractedAsin) return null;

    // Sanity check: if review count is suspiciously low for a rated book,
    // treat it as a scraping error and store null
    const sanitizedCount = (ratingCount !== null && ratingCount < 10) ? null : ratingCount;

    return {
      rating,
      ratingCount: sanitizedCount ?? 0,
      asin: extractedAsin,
    };
  } catch (err) {
    console.warn(`Amazon scraping failed for ISBN ${isbn}:`, err);
    return null;
  }
}
