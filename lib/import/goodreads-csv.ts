/**
 * Parses a Goodreads CSV export into structured book data.
 *
 * Goodreads CSV columns (order may vary):
 * Book Id, Title, Author, Author l-f, Additional Authors, ISBN, ISBN13,
 * My Rating, Average Rating, Publisher, Binding, Number of Pages, Year Published,
 * Original Publication Year, Date Read, Date Added, Bookshelves, Bookshelves with positions,
 * Exclusive Shelf, My Review, Spoiler, Private Notes, Read Count, Owned Copies
 */

export interface GoodreadsImport {
  goodreadsId: string;
  title: string;
  author: string;
  isbn: string | null;
  isbn13: string | null;
  rating: number | null;
  shelf: string; // "read", "currently-reading", "to-read", or custom
  dateRead: string | null;
}

/**
 * Parse a raw CSV string from a Goodreads export.
 * Handles quoted fields with commas and newlines inside.
 */
export function parseGoodreadsCsv(csvText: string): GoodreadsImport[] {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const colIdx = (name: string) => headers.indexOf(name);

  const iTitle = colIdx("title");
  const iAuthor = colIdx("author");
  const iIsbn = colIdx("isbn");
  const iIsbn13 = colIdx("isbn13");
  const iRating = colIdx("my rating");
  const iShelf = colIdx("exclusive shelf");
  const iDateRead = colIdx("date read");
  const iBookId = colIdx("book id");

  if (iTitle === -1 || iAuthor === -1) return [];

  const results: GoodreadsImport[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < headers.length) continue;

    const title = cleanTitle(row[iTitle]);
    const author = row[iAuthor]?.trim();
    if (!title || !author) continue;

    const rating = iRating !== -1 ? parseInt(row[iRating], 10) : NaN;

    results.push({
      goodreadsId: iBookId !== -1 ? row[iBookId]?.trim() : "",
      title,
      author,
      isbn: cleanIsbn(iIsbn !== -1 ? row[iIsbn] : null),
      isbn13: cleanIsbn(iIsbn13 !== -1 ? row[iIsbn13] : null),
      rating: !isNaN(rating) && rating > 0 ? rating : null,
      shelf: iShelf !== -1 ? row[iShelf]?.trim().toLowerCase() || "to-read" : "to-read",
      dateRead: iDateRead !== -1 ? row[iDateRead]?.trim() || null : null,
    });
  }

  return results;
}

/** Strip Goodreads' weird ="..." ISBN wrapping and leading zeros padding */
function cleanIsbn(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^="/, "").replace(/"$/, "").trim();
  return cleaned && cleaned !== "0" ? cleaned : null;
}

/** Strip series info from title e.g. "Fourth Wing (The Empyrean, #1)" → "Fourth Wing" */
function cleanTitle(raw: string): string {
  return raw
    .replace(/\s*\([^)]*#\d+[^)]*\)\s*$/, "")
    .trim();
}

/**
 * RFC 4180-compliant CSV parser.
 * Handles quoted fields, escaped quotes (""), and newlines within quotes.
 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        row.push(field);
        field = "";
        i++;
      } else if (ch === "\n" || ch === "\r") {
        row.push(field);
        field = "";
        if (ch === "\r" && i + 1 < text.length && text[i + 1] === "\n") {
          i++;
        }
        if (row.some((f) => f.trim())) {
          rows.push(row);
        }
        row = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Last field/row
  row.push(field);
  if (row.some((f) => f.trim())) {
    rows.push(row);
  }

  return rows;
}
