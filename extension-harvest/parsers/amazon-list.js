/**
 * Amazon List Parser — extracts books from Amazon list/category pages.
 * Self-contained IIFE. Depends on utils.js being injected first.
 * CRITICAL: Does NOT rely on Amazon class names (generated, A/B tested).
 */
(() => {
  const books = [];
  const seenAsins = new Set();

  // Step 1: Find all product links with ASINs
  const allLinks = document.querySelectorAll("a[href]");
  const asinLinks = [];
  for (const link of allLinks) {
    const match = link.href.match(/\/dp\/([A-Z0-9]{10})/);
    if (match && !seenAsins.has(match[1])) {
      asinLinks.push({ element: link, asin: match[1] });
      seenAsins.add(match[1]);
    }
  }

  // Step 2: For each unique ASIN, find the product card and extract data
  for (const { element: link, asin } of asinLinks) {
    try {
      // Walk up to find the card container
      let card = link.parentElement;
      for (let i = 0; i < 10 && card; i++) {
        const rect = card.getBoundingClientRect();
        if (rect.height > 100) {
          const hasImg = card.querySelector("img");
          if (hasImg) break;
        }
        card = card.parentElement;
      }
      if (!card) card = link.parentElement?.parentElement || link.parentElement;

      // Title: text content of the product link, or longest heading-like text
      let title = link.textContent.trim();
      if (!title || title.length < 2) {
        const headings = card.querySelectorAll("h2, h3, h4, [data-cy], span");
        let longest = "";
        for (const h of headings) {
          const t = h.textContent.trim();
          if (t.length > longest.length && t.length < 200) longest = t;
        }
        title = longest;
      }
      if (!title || title.length < 2) continue;

      // Author: look for "by Name" pattern or author link
      let author = null;
      const authorLink = card.querySelector("a[href*='/e/'], a[href*='/stores/author/']");
      if (authorLink) {
        author = authorLink.textContent.trim();
      } else {
        // Search for "by Author Name" in nearby text
        const textNodes = card.querySelectorAll("span, div, a");
        for (const node of textNodes) {
          const text = node.textContent.trim();
          const byMatch = text.match(/^by\s+(.+)/i);
          if (byMatch && byMatch[1].length > 2 && byMatch[1].length < 60) {
            author = byMatch[1].trim();
            break;
          }
        }
      }

      // Rating: aria-label "X.X out of 5 stars"
      let amazonRating = null;
      const ratingEl = card.querySelector("[aria-label*='out of 5 stars']");
      if (ratingEl) {
        const ratingMatch = ratingEl.getAttribute("aria-label").match(/([\d.]+)\s*out of 5/);
        if (ratingMatch) amazonRating = parseFloat(ratingMatch[1]);
      }

      // Rating count: nearby text matching digits
      let amazonRatingCount = null;
      if (ratingEl) {
        const sibling = ratingEl.closest("div")?.parentElement;
        if (sibling) {
          const countText = sibling.textContent;
          const countMatch = countText.match(/([\d,]+)\s*(?:ratings?|reviews?)/i);
          if (countMatch) amazonRatingCount = parseInt(countMatch[1].replace(/,/g, ""), 10);
        }
      }

      // Cover: img in card that looks like a book cover
      let coverUrl = null;
      const images = card.querySelectorAll("img");
      for (const img of images) {
        const src = img.src || img.getAttribute("data-src") || "";
        if (src.includes("images") && src.length > 10) {
          coverUrl = src;
          break;
        }
      }

      // Series: "Book N of M" or "Part of: Series (N books)"
      let seriesName = null;
      let seriesPosition = null;
      const cardText = card.textContent;
      const seriesMatch1 = cardText.match(/Book\s+(\d+)\s+of\s+(\d+)\s*:/);
      const seriesMatch2 = cardText.match(/Part of:\s*(.+?)\s*\((\d+)\s*books?\)/i);
      if (seriesMatch1) {
        seriesPosition = parseInt(seriesMatch1[1], 10);
      } else if (seriesMatch2) {
        seriesName = seriesMatch2[1].trim();
      }

      // Format
      let format = null;
      const formatPatterns = ["Kindle Edition", "Audible Audiobook", "Hardcover", "Paperback"];
      for (const fp of formatPatterns) {
        if (cardText.includes(fp)) {
          format = normalizeFormat(fp);
          break;
        }
      }

      // Clean title
      const cleaned = cleanTitle(title);
      const series = parseSeries(cleaned);

      const book = {
        title: series.cleanedTitle || cleaned,
        author,
        goodreadsId: null,
        asin,
        isbn13: null,
        coverUrl,
        goodreadsRating: null,
        goodreadsRatingCount: null,
        amazonRating,
        amazonRatingCount,
        romanceIoSpice: null,
        seriesName: seriesName || series.seriesName,
        seriesPosition: seriesPosition || series.seriesPosition,
        format,
        source: "amazon_list",
        harvestedAt: new Date().toISOString(),
      };

      books.push(book);
    } catch (e) {
      // Skip malformed cards
    }
  }

  // Dedup by normalized title+author — prefer edition with highest rating count
  const dedupMap = new Map();
  for (const book of books) {
    const key = dedupKey(book);
    if (!key) continue;
    const existing = dedupMap.get(key);
    if (!existing) {
      dedupMap.set(key, book);
    } else {
      // Keep the one with higher rating count
      if ((book.amazonRatingCount || 0) > (existing.amazonRatingCount || 0)) {
        dedupMap.set(key, mergeBooks(book, existing));
      } else {
        dedupMap.set(key, mergeBooks(existing, book));
      }
    }
  }

  const deduped = Array.from(dedupMap.values());
  let confidence = "none";
  if (deduped.length >= 10) confidence = "high";
  else if (deduped.length >= 3) confidence = "medium";
  else if (deduped.length >= 1) confidence = "low";

  return { books: deduped, confidence, parser: "amazon-list", url: location.href };
})();
