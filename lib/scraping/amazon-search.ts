/**
 * Amazon rating lookup via Serper (Google Search API).
 *
 * Replaces direct Amazon scraping which returns 503 errors.
 * Uses the same SERPER_API_KEY as the romance.io spice lookup.
 * Cost: ~$0.001 per query (up to 2 queries for fallback).
 *
 * Strategy:
 * 1. First try a broad query: `"title" author amazon rating` — this surfaces
 *    Google's knowledge graph and rich snippets which often include star ratings.
 * 2. If that misses, fall back to `site:amazon.com "title" author` which
 *    restricts to Amazon pages but has lower hit rate for rating extraction.
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

  // Minimum rating count to consider a result trustworthy — lower counts
  // often indicate a wrong-edition match (e.g. an audiobook or ARC listing)
  const MIN_TRUSTED_COUNT = 50;

  try {
    // Strategy 1: Broad query — surfaces knowledge graph + rich snippets
    const broadQuery = isbn
      ? `"${isbn}" amazon rating`
      : `"${title}" ${author} amazon book rating`;

    const result = await searchSerper(apiKey, broadQuery);
    if (result && result.ratingCount >= MIN_TRUSTED_COUNT) return result;

    // Strategy 2: If ISBN query returned a low-count result, retry with
    // title+author instead — the ISBN may have matched a niche edition
    if (isbn && (!result || result.ratingCount < MIN_TRUSTED_COUNT)) {
      const titleQuery = `"${title}" ${author} amazon book rating`;
      const titleResult = await searchSerper(apiKey, titleQuery);
      if (titleResult && titleResult.ratingCount >= MIN_TRUSTED_COUNT) return titleResult;
      // If title query also low-count, prefer the higher-count result
      if (titleResult && result && titleResult.ratingCount > result.ratingCount) return titleResult;
      if (titleResult && !result) return titleResult;
    }

    // Strategy 3: Site-restricted fallback — guaranteed Amazon pages
    const siteQuery = isbn
      ? `site:amazon.com "${isbn}"`
      : `site:amazon.com "${title}" ${author} book`;

    const siteResult = await searchSerper(apiKey, siteQuery);
    if (siteResult && siteResult.ratingCount >= MIN_TRUSTED_COUNT) return siteResult;

    // Return best available result even if low-count (display layer will suppress)
    return result ?? siteResult;
  } catch (err) {
    console.warn("[amazon-search] Failed:", err);
    return null;
  }
}

async function searchSerper(
  apiKey: string,
  query: string
): Promise<AmazonData | null> {
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

  // Check knowledge graph first — Google often shows Amazon ratings here
  const kgResult = extractFromKnowledgeGraph(data.knowledgeGraph);
  if (kgResult) return kgResult;

  // Check answer box — "4.5 out of 5 stars" sometimes appears here
  const abResult = extractFromAnswerBox(data.answerBox);
  if (abResult) return abResult;

  // Fall back to organic results
  const results: SerperResult[] = data.organic ?? [];

  // Accumulate best rating and best ASIN separately across results
  let bestRating: { rating: number; ratingCount: number } | null = null;
  let bestAsin = "";

  for (const result of results) {
    // Extract ASIN from Amazon product page URL (/dp/ or /gp/product/)
    if (!bestAsin && result.link) {
      const asinMatch = result.link.match(
        /amazon\.com(?:\/[^/]+)?\/(?:dp|gp\/product)\/([A-Z0-9]{10})/
      );
      if (asinMatch) bestAsin = asinMatch[1];
    }

    // Combine all text fields for rating extraction
    const texts = [
      result.snippet,
      result.title,
      result.richSnippet,
    ].filter(Boolean);

    for (const text of texts) {
      const extracted = extractRatingFromText(text!);
      if (extracted && !bestRating) {
        bestRating = extracted;
      }
    }

    // Also check attributes
    if (!bestRating && result.attributes) {
      for (const [key, value] of Object.entries(result.attributes)) {
        if (/rating/i.test(key) && typeof value === "string") {
          const extracted = extractRatingFromText(value);
          if (extracted) bestRating = extracted;
        }
      }
    }

    // If we have both, return early
    if (bestRating && bestAsin) {
      return { ...bestRating, asin: bestAsin };
    }
  }

  // Return rating even without ASIN — the rating is valuable on its own
  if (bestRating) {
    return { ...bestRating, asin: bestAsin };
  }

  // Return ASIN even without rating — ASINs power affiliate buy links
  if (bestAsin) {
    return { rating: 0, ratingCount: 0, asin: bestAsin };
  }

  return null;
}

/**
 * Extract rating from Google's knowledge graph panel.
 * Serper returns this as `knowledgeGraph.rating` and `knowledgeGraph.ratingCount`.
 */
function extractFromKnowledgeGraph(
  kg: SerperKnowledgeGraph | undefined
): AmazonData | null {
  if (!kg) return null;

  // Direct rating fields
  if (typeof kg.rating === "number" && kg.rating >= 1 && kg.rating <= 5) {
    const ratingCount =
      typeof kg.ratingCount === "number" ? kg.ratingCount : 0;
    // Need an ASIN — check the URL or description
    const asin = extractAsinFromText(kg.website ?? kg.description ?? "");
    return { rating: kg.rating, ratingCount, asin: asin ?? "" };
  }

  // Sometimes rating is in the description text
  if (kg.description) {
    const extracted = extractRatingFromText(kg.description);
    if (extracted) {
      const asin = extractAsinFromText(kg.website ?? kg.description ?? "");
      return { ...extracted, asin: asin ?? "" };
    }
  }

  return null;
}

/**
 * Extract rating from Serper's answer box.
 */
function extractFromAnswerBox(
  ab: SerperAnswerBox | undefined
): AmazonData | null {
  if (!ab) return null;

  const text = ab.answer ?? ab.snippet ?? ab.title ?? "";
  const extracted = extractRatingFromText(text);
  if (!extracted) return null;

  const asin = extractAsinFromText(ab.link ?? text);
  return { ...extracted, asin: asin ?? "" };
}

/**
 * Extract "X out of 5 stars" or "X/5" rating patterns from text.
 */
function extractRatingFromText(
  text: string
): { rating: number; ratingCount: number } | null {
  // "4.6 out of 5 stars" or "Rating: 4.6 out of 5"
  const starsMatch = text.match(
    /(\d+(?:\.\d+)?)\s*out\s*of\s*5\s*stars?/i
  );
  // "4.6/5" pattern
  const slashMatch = !starsMatch
    ? text.match(/(\d+(?:\.\d+)?)\s*\/\s*5(?:\s|$|[^0-9])/)
    : null;

  const ratingMatch = starsMatch ?? slashMatch;
  if (!ratingMatch) return null;

  const rating = parseFloat(ratingMatch[1]);
  if (rating < 1 || rating > 5) return null;

  // Extract rating count — "12,345 ratings" or "1,234 reviews"
  let ratingCount = 0;
  const countMatch = text.match(
    /([\d,]+)\s*(?:ratings?|reviews?|global ratings?)/i
  );
  if (countMatch) {
    ratingCount = parseInt(countMatch[1].replace(/,/g, ""), 10);
  }

  return { rating, ratingCount };
}

/**
 * Extract ASIN from a URL or text containing an Amazon product link.
 */
function extractAsinFromText(text: string): string | null {
  const match = text.match(/amazon\.com(?:\/[^/]+)?\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
  return match?.[1] ?? null;
}

interface SerperResult {
  title?: string;
  link?: string;
  snippet?: string;
  richSnippet?: string;
  attributes?: Record<string, string>;
}

interface SerperKnowledgeGraph {
  title?: string;
  description?: string;
  website?: string;
  rating?: number;
  ratingCount?: number;
}

interface SerperAnswerBox {
  title?: string;
  answer?: string;
  snippet?: string;
  link?: string;
}
