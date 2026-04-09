/**
 * Shared utilities for Book Harvester parsers.
 * Injected alongside site-specific parsers via chrome.scripting.executeScript().
 */

function normalizeForDedup(title) {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'") // smart quotes → straight
    .replace(/[^\w\s']/g, "") // strip non-word chars except apostrophes
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "");
}

function dedupKey(book) {
  if (book.goodreadsId) return `gr:${book.goodreadsId}`;
  if (book.asin) return `asin:${book.asin}`;
  const normTitle = normalizeForDedup(book.title);
  const authorLast = (book.author || "")
    .trim()
    .split(/\s+/)
    .pop()
    ?.toLowerCase();
  if (normTitle && authorLast) return `ta:${normTitle}::${authorLast}`;
  return null;
}

function mergeBooks(existing, incoming) {
  const merged = { ...existing };
  for (const key of Object.keys(incoming)) {
    if (incoming[key] != null && merged[key] == null) {
      merged[key] = incoming[key];
    }
  }
  // Always prefer identifiers from either source
  if (incoming.goodreadsId && !merged.goodreadsId) merged.goodreadsId = incoming.goodreadsId;
  if (incoming.asin && !merged.asin) merged.asin = incoming.asin;
  return merged;
}

function parseSeries(title) {
  if (!title) return { seriesName: null, seriesPosition: null, cleanedTitle: title };

  // Match: "(Series Name, #N)" or "(Series Name #N)" or "(Series Name Book N)" or "(Series Name, N)"
  const patterns = [
    /\(([^)]+?)(?:,\s*)?#(\d+)\)\s*$/i,        // (Series, #2) or (Series #2)
    /\(([^)]+?),\s*Book\s+(\d+)\)\s*$/i,        // (Series, Book 2)
    /\(([^)]+?),\s*(\d+)\)\s*$/i,               // (Series, 1)
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      return {
        seriesName: match[1].trim(),
        seriesPosition: parseInt(match[2], 10),
        cleanedTitle: title.replace(pattern, "").trim(),
      };
    }
  }

  return { seriesName: null, seriesPosition: null, cleanedTitle: title };
}

function normalizeFormat(formatText) {
  if (!formatText) return null;
  const lower = formatText.toLowerCase().trim();
  if (lower.includes("kindle")) return "kindle";
  if (lower.includes("audio")) return "audiobook";
  if (lower.includes("hardcover") || lower.includes("hard cover")) return "hardcover";
  if (lower.includes("paperback") || lower.includes("mass market")) return "paperback";
  return null;
}

function cleanTitle(title) {
  if (!title) return title;
  return title
    // Strip trailing format labels like "(Kindle Edition)", "(Hardcover)", etc.
    .replace(/\s*\((Kindle Edition|Hardcover|Paperback|Mass Market Paperback|Audio CD|Audible Audiobook)\)\s*$/i, "")
    // Strip marketing subtitles after colon (e.g., "Heir of Prophecy: A stunning new romantasy from...")
    .replace(/:\s*(?:A\s+)?(?:stunning|brand.new|new|bestselling|sunday\s+times|nyt|from\s+the|the\s+#?\d).*$/i, "")
    .trim();
}

function cleanAuthor(author) {
  if (!author) return author;
  // Collapse multiple spaces (e.g., "Kate  Golden" → "Kate Golden")
  return author.replace(/\s+/g, " ").trim();
}
