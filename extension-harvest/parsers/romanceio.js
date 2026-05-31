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

  function extractRomanceIoSlug(href) {
    try {
      const url = new URL(href);
      const parts = url.pathname.split("/").filter(Boolean);
      const bookIndex = parts.indexOf("books");
      return bookIndex >= 0 ? parts[bookIndex + 1] || null : null;
    } catch {
      return null;
    }
  }

  function extractSpice(card) {
    const cardText = card.textContent || "";
    const flameMatch = cardText.match(/(🔥+)/);
    if (flameMatch) {
      const count = [...flameMatch[1]].filter(
        (c) => c === "🔥" || c.codePointAt(0) === 0x1F525
      ).length;
      if (count >= 1 && count <= 5) return count;
    }

    const numericMatch = cardText.match(
      /(?:spice|steam|heat|open\s*door)[^\d]{0,20}([1-5])(?:\s*\/\s*5)?/i
    );
    if (numericMatch) return parseInt(numericMatch[1], 10);

    const ariaEls = card.querySelectorAll("[aria-label], [title]");
    for (const el of ariaEls) {
      const label = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`;
      const labelMatch = label.match(/(?:spice|steam|heat|flame)[^\d]{0,20}([1-5])/i);
      if (labelMatch) return parseInt(labelMatch[1], 10);
    }

    const spiceEls = card.querySelectorAll(
      "[class*='spice'], [class*='steam'], [class*='flame'], [class*='heat']"
    );
    for (const el of spiceEls) {
      const num = parseInt(el.textContent.trim(), 10);
      if (num >= 1 && num <= 5) return num;
      const activeIcons = el.querySelectorAll(
        "svg[class*='active'], svg[class*='filled'], .active, .filled"
      );
      if (activeIcons.length >= 1 && activeIcons.length <= 5) {
        return activeIcons.length;
      }
    }

    const flames = card.querySelectorAll(
      "svg[class*='flame'], svg[class*='fire'], svg[aria-label*='flame'], svg[aria-label*='fire']"
    );
    if (flames.length >= 1 && flames.length <= 5) return flames.length;

    return null;
  }

  for (const link of bookLinks) {
    try {
      const href = link.href;
      if (processedHrefs.has(href)) continue;
      processedHrefs.add(href);
      const romanceIoSlug = extractRomanceIoSlug(href);

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
      // Skip navigation elements
      if (title.toLowerCase().includes("find similar") || title.toLowerCase().includes("browse") || title.toLowerCase().includes("sign in")) continue;

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
      const romanceIoSpice = extractSpice(card);

      // Cover image
      let coverUrl = null;
      const img = card.querySelector("img");
      if (img) coverUrl = img.src || img.getAttribute("data-src") || null;
      if (coverUrl && coverUrl.includes("placeholder.png")) coverUrl = null;

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

      const cleaned = cleanTitle(title.replace(/\s+/g, " "));
      const series = parseSeries(cleaned);

      const book = {
        title: series.cleanedTitle || cleaned,
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
        romanceIoSlug,
        seriesName: series.seriesName,
        seriesPosition: series.seriesPosition,
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
