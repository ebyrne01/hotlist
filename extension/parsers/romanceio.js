/**
 * Romance.io Parser — extracts books from romance.io/new* pages.
 * Self-contained IIFE. Depends on utils.js being injected first.
 */
(() => {
  const books = [];
  const seen = new Set();

  // Romance.io renders book cards — find them by looking for elements
  // containing both an image and text that looks like a book title.
  // Try common card patterns: article, li, div with book-like content.

  // Strategy 1: Look for links to book detail pages
  const bookLinks = document.querySelectorAll("a[href*='/books/']");
  const processedHrefs = new Set();

  for (const link of bookLinks) {
    try {
      const href = link.href;
      if (processedHrefs.has(href)) continue;
      processedHrefs.add(href);

      // Walk up to the card container
      let card = link;
      for (let i = 0; i < 5; i++) {
        if (card.parentElement) card = card.parentElement;
        // Stop at a reasonable container
        const rect = card.getBoundingClientRect();
        if (rect.height > 80 && rect.width > 100) break;
      }

      // Title — the link text or a nearby heading
      let title = link.textContent.trim();
      if (!title || title.length < 2) {
        const heading = card.querySelector("h2, h3, h4");
        if (heading) title = heading.textContent.trim();
      }
      if (!title || title.length < 2) continue;

      // Author — look for text after "by" or in a separate element
      let author = null;
      const allText = card.querySelectorAll("span, p, div, a");
      for (const el of allText) {
        const t = el.textContent.trim();
        if (t.startsWith("by ") && t.length > 4 && t.length < 60) {
          author = t.replace(/^by\s+/i, "").trim();
          break;
        }
        // Author links on romance.io
        if (el.tagName === "A" && el.href && el.href.includes("/authors/")) {
          author = el.textContent.trim();
          break;
        }
      }

      // Spice/flame rating — the unique high-value data from romance.io
      let romanceIoSpice = null;
      // Look for flame emoji count
      const cardText = card.textContent;
      const flameMatch = cardText.match(/(🔥+)/);
      if (flameMatch) {
        // Count flame emoji (each is 2 chars in JS for the emoji)
        romanceIoSpice = [...flameMatch[1]].filter(c => c === '🔥' || c.codePointAt(0) === 0x1F525).length;
        if (romanceIoSpice === 0) romanceIoSpice = flameMatch[1].length; // fallback
      }
      // Also check for numeric spice indicators or flame SVGs
      if (!romanceIoSpice) {
        const spiceEls = card.querySelectorAll("[class*='spice'], [class*='flame'], [class*='heat']");
        for (const el of spiceEls) {
          const num = parseInt(el.textContent.trim(), 10);
          if (num >= 1 && num <= 5) {
            romanceIoSpice = num;
            break;
          }
        }
      }
      // Count flame SVG icons
      if (!romanceIoSpice) {
        const flames = card.querySelectorAll("svg[class*='flame'], svg[class*='fire'], svg[aria-label*='flame']");
        if (flames.length >= 1 && flames.length <= 5) {
          romanceIoSpice = flames.length;
        }
      }

      // Cover image
      let coverUrl = null;
      const img = card.querySelector("img");
      if (img) coverUrl = img.src || img.getAttribute("data-src") || null;

      // Amazon link → extract ASIN
      let asin = null;
      const amazonLink = card.querySelector("a[href*='amazon.com']");
      if (amazonLink) {
        const asinMatch = amazonLink.href.match(/\/dp\/([A-Z0-9]{10})/);
        if (asinMatch) asin = asinMatch[1];
      }

      // Goodreads link → extract ID
      let goodreadsId = null;
      const grLink = card.querySelector("a[href*='goodreads.com/book/show/']");
      if (grLink) {
        const grMatch = grLink.href.match(/\/book\/show\/(\d+)/);
        if (grMatch) goodreadsId = grMatch[1];
      }

      const book = {
        title: cleanTitle(title),
        author,
        goodreadsId,
        asin,
        isbn13: null,
        coverUrl,
        goodreadsRating: null,
        goodreadsRatingCount: null,
        amazonRating: null,
        amazonRatingCount: null,
        romanceIoSpice,
        seriesName: null,
        seriesPosition: null,
        format: null,
        source: "romanceio",
        harvestedAt: new Date().toISOString(),
      };

      const key = dedupKey(book);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      books.push(book);
    } catch (e) {
      // Skip
    }
  }

  let confidence = "none";
  if (books.length >= 10) confidence = "high";
  else if (books.length >= 3) confidence = "medium";
  else if (books.length >= 1) confidence = "low";

  return { books, confidence, parser: "romanceio", url: location.href };
})();
