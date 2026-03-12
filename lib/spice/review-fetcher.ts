/**
 * REVIEW FETCHER — Retrieves review text from Goodreads and Amazon
 *
 * Goodreads: Scrapes the first visible reviews from a book page.
 * Amazon: Uses Serper to find review snippets from search results.
 *
 * Both return arrays of review text strings (aim for 5-10 per source).
 */

import * as cheerio from "cheerio";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const GOODREADS_DELAY_MS = 1500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Scrape the first visible reviews from a Goodreads book page.
 * Returns an array of review text strings (up to 10).
 */
export async function fetchGoodreadsReviews(
  goodreadsUrl: string
): Promise<string[]> {
  if (!goodreadsUrl) return [];

  try {
    await sleep(GOODREADS_DELAY_MS);

    const res = await fetch(goodreadsUrl, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });

    if (!res.ok) {
      console.warn(
        `[review-fetcher] Goodreads returned ${res.status} for ${goodreadsUrl}`
      );
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const reviews: string[] = [];

    // Modern Goodreads layout: review cards with data-testid
    $('[data-testid="review"] .Formatted, .ReviewText__content .Formatted').each(
      (_, el) => {
        const text = $(el).text().trim();
        if (text.length >= 30) {
          reviews.push(text);
        }
      }
    );

    // Fallback: older review layout
    if (reviews.length === 0) {
      $(".reviewText .readable span[style*='display:none'], .reviewText span:not([style])").each(
        (_, el) => {
          const text = $(el).text().trim();
          if (text.length >= 30 && !reviews.includes(text)) {
            reviews.push(text);
          }
        }
      );
    }

    // Another fallback: any review-like content
    if (reviews.length === 0) {
      $("[class*='ReviewCard'] [class*='Formatted'], [class*='reviewBody']").each(
        (_, el) => {
          const text = $(el).text().trim();
          if (text.length >= 30 && !reviews.includes(text)) {
            reviews.push(text);
          }
        }
      );
    }

    const result = reviews.slice(0, 10);
    console.log(
      `[review-fetcher] Fetched ${result.length} Goodreads reviews from ${goodreadsUrl}`
    );
    return result;
  } catch (err) {
    console.warn(
      `[review-fetcher] Failed to fetch Goodreads reviews:`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * Use Serper to find Amazon review snippets for a book.
 * Returns an array of review snippet strings.
 */
export async function fetchAmazonReviewSnippets(
  title: string,
  author: string,
  asin?: string | null
): Promise<string[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  try {
    // Build search query — prefer ASIN if available
    const query = asin
      ? `site:amazon.com/review "${asin}" book reviews`
      : `site:amazon.com "${title}" ${author} book reviews`;

    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        num: 10,
        gl: "us",
      }),
    });

    if (!res.ok) {
      console.warn(`[review-fetcher] Serper returned ${res.status}`);
      return [];
    }

    const data = await res.json();
    const results: { snippet?: string }[] = data.organic ?? [];
    const snippets: string[] = [];

    for (const result of results) {
      if (result.snippet && result.snippet.length >= 30) {
        snippets.push(result.snippet);
      }
    }

    console.log(
      `[review-fetcher] Found ${snippets.length} Amazon review snippets for "${title}"`
    );
    return snippets.slice(0, 10);
  } catch (err) {
    console.warn(
      `[review-fetcher] Failed to fetch Amazon reviews:`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * Fetch reviews from all available sources for a book.
 * Returns combined array of review texts.
 */
export async function fetchAllReviews(book: {
  goodreadsUrl?: string | null;
  title: string;
  author: string;
  amazonAsin?: string | null;
}): Promise<string[]> {
  const results = await Promise.allSettled([
    book.goodreadsUrl
      ? fetchGoodreadsReviews(book.goodreadsUrl)
      : Promise.resolve([]),
    fetchAmazonReviewSnippets(book.title, book.author, book.amazonAsin),
  ]);

  const reviews: string[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      reviews.push(...result.value);
    }
  }

  return reviews;
}
