/**
 * Goodreads List Parser — extracts books from goodreads.com/list/* pages.
 * Self-contained IIFE. Depends on utils.js being injected first.
 */
(() => {
  const books = [];
  const seen = new Set();

  // ── Primary path: schema.org Book rows ──
  const rows = document.querySelectorAll("tr[itemtype='http://schema.org/Book']");

  for (const row of rows) {
    try {
      const titleLink = row.querySelector("a.bookTitle");
      if (!titleLink) continue;

      // Extract Goodreads ID from href
      const hrefMatch = titleLink.href.match(/\/book\/show\/(\d+)/);
      const goodreadsId = hrefMatch ? hrefMatch[1] : null;

      // Title — clean format labels and parse series
      let rawTitle = (titleLink.textContent || "").trim();
      const format = normalizeFormat(rawTitle);
      rawTitle = cleanTitle(rawTitle);
      const { seriesName, seriesPosition, cleanedTitle } = parseSeries(rawTitle);

      // Author
      const authorLink = row.querySelector("a.authorName");
      const author = authorLink ? authorLink.textContent.trim() : null;

      // Rating — "X.XX avg rating — N,NNN ratings"
      const miniRating = row.querySelector(".minirating");
      let goodreadsRating = null;
      let goodreadsRatingCount = null;
      if (miniRating) {
        const ratingText = miniRating.textContent || "";
        const ratingMatch = ratingText.match(/([\d.]+)\s*avg\s*rating/);
        const countMatch = ratingText.match(/\u2014\s*([\d,]+)\s*rating/);
        if (ratingMatch) goodreadsRating = parseFloat(ratingMatch[1]);
        if (countMatch) goodreadsRatingCount = parseInt(countMatch[1].replace(/,/g, ""), 10);
      }

      // Cover image — upgrade thumbnail to medium size
      const img = row.querySelector("img");
      let coverUrl = img ? (img.src || img.getAttribute("data-src") || null) : null;
      if (coverUrl) {
        coverUrl = coverUrl
          .replace(/\._S[XY]\d+_/, "._SX200_")
          .replace(/\/s\//, "/m/");
      }

      const book = {
        title: cleanedTitle || rawTitle,
        author,
        goodreadsId,
        asin: null,
        isbn13: null,
        coverUrl,
        goodreadsRating,
        goodreadsRatingCount,
        amazonRating: null,
        amazonRatingCount: null,
        romanceIoSpice: null,
        seriesName,
        seriesPosition,
        format,
        source: "goodreads_list",
        harvestedAt: new Date().toISOString(),
      };

      const key = dedupKey(book);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      books.push(book);
    } catch (e) {
      // Skip malformed rows
    }
  }

  if (books.length > 0) {
    const confidence = books.length >= 10 ? "high" : books.length >= 3 ? "medium" : "low";
    return { books, confidence, parser: "goodreads-list", url: location.href };
  }

  // ── Fallback path: scrape all book links ──
  const fallbackBooks = [];
  const fallbackSeen = new Set();
  const bookLinks = document.querySelectorAll("a[href*='/book/show/']");

  for (const link of bookLinks) {
    try {
      const hrefMatch = link.href.match(/\/book\/show\/(\d+)/);
      if (!hrefMatch) continue;
      const goodreadsId = hrefMatch[1];
      if (fallbackSeen.has(goodreadsId)) continue;
      fallbackSeen.add(goodreadsId);

      const title = link.textContent.trim();
      if (!title || title.length < 2) continue;

      // Walk up to find author
      let author = null;
      let container = link.parentElement;
      for (let i = 0; i < 5 && container; i++) {
        const authorLink = container.querySelector("a[href*='/author/show/']");
        if (authorLink) {
          author = authorLink.textContent.trim();
          break;
        }
        container = container.parentElement;
      }

      const cleaned = cleanTitle(title);
      const { seriesName, seriesPosition, cleanedTitle } = parseSeries(cleaned);

      fallbackBooks.push({
        title: cleanedTitle || cleaned,
        author,
        goodreadsId,
        asin: null,
        isbn13: null,
        coverUrl: null,
        goodreadsRating: null,
        goodreadsRatingCount: null,
        amazonRating: null,
        amazonRatingCount: null,
        romanceIoSpice: null,
        seriesName,
        seriesPosition,
        format: null,
        source: "goodreads_list",
        harvestedAt: new Date().toISOString(),
      });
    } catch (e) {
      // Skip
    }
  }

  if (fallbackBooks.length > 0) {
    const confidence = fallbackBooks.length >= 3 ? "medium" : "low";
    return { books: fallbackBooks, confidence, parser: "goodreads-list", url: location.href };
  }

  return { books: [], confidence: "none", parser: "goodreads-list", url: location.href };
})();
