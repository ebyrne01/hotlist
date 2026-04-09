/**
 * Generic Links Parser — fallback for blogs and unrecognized pages.
 * Self-contained IIFE. Depends on utils.js being injected first.
 *
 * Does NOT try to parse titles from editorial HTML (too inconsistent).
 * Only extracts identifiers (Goodreads ID, ASIN, ISBN) from links.
 */
(() => {
  const books = [];
  const seenIds = new Set();

  const allLinks = document.querySelectorAll("a[href]");

  for (const link of allLinks) {
    try {
      const href = link.href || "";
      let goodreadsId = null;
      let asin = null;
      let isbn13 = null;

      // Goodreads book link
      const grMatch = href.match(/goodreads\.com\/book\/show\/(\d+)/);
      if (grMatch) goodreadsId = grMatch[1];

      // Amazon product link
      const asinMatch = href.match(/amazon\.com(?:\/[^/]+)?\/dp\/([A-Z0-9]{10})/)
        || href.match(/amazon\.com\/gp\/product\/([A-Z0-9]{10})/);
      if (asinMatch) asin = asinMatch[1];

      // Bookshop.org with ISBN-13
      const isbnMatch = href.match(/bookshop\.org.*?(\d{13})/);
      if (isbnMatch) isbn13 = isbnMatch[1];

      if (!goodreadsId && !asin && !isbn13) continue;

      // Dedup by primary identifier
      const idKey = goodreadsId ? `gr:${goodreadsId}` : asin ? `asin:${asin}` : `isbn:${isbn13}`;
      if (seenIds.has(idKey)) {
        // Merge: find existing and add any new identifiers
        const existing = books.find(b => dedupKey(b) === idKey);
        if (existing) {
          if (goodreadsId && !existing.goodreadsId) existing.goodreadsId = goodreadsId;
          if (asin && !existing.asin) existing.asin = asin;
          if (isbn13 && !existing.isbn13) existing.isbn13 = isbn13;
        }
        continue;
      }
      seenIds.add(idKey);

      books.push({
        title: null,
        author: null,
        goodreadsId,
        asin,
        isbn13,
        coverUrl: null,
        goodreadsRating: null,
        goodreadsRatingCount: null,
        amazonRating: null,
        amazonRatingCount: null,
        romanceIoSpice: null,
        seriesName: null,
        seriesPosition: null,
        format: null,
        source: "blog_links",
        harvestedAt: new Date().toISOString(),
      });
    } catch (e) {
      // Skip
    }
  }

  let confidence = "none";
  if (books.length >= 5) confidence = "medium";
  else if (books.length >= 1) confidence = "low";

  return { books, confidence, parser: "generic-links", url: location.href };
})();
