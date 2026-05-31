/**
 * TOP LIST COVERAGE AUDIT
 *
 * Audits a harvested "top books" CSV against production coverage.
 *
 *   npm run audit:top-list -- <path-to-csv>
 *
 * Outputs JSON + CSV reports in scripts/audit-reports/ with:
 * rank/title/author/source -> matched? -> canon? -> Amazon rating?
 * -> Goodreads rating? -> romance.io spice? -> recommended action.
 */

import { config as loadEnv } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { createClient } from "@supabase/supabase-js";
import { isRomantasyDiscoveryCandidate } from "@/lib/books/discovery-focus";
import { isJunkTitle } from "@/lib/books/romance-filter";

loadEnv({ path: ".env.local", quiet: true });

type CsvRow = Record<string, string>;

type HarvestRow = {
  rank: number;
  title: string;
  author: string;
  source: string;
  asin: string | null;
  goodreadsId: string | null;
  isbn13: string | null;
  romanceIoSlug: string | null;
  amazonHarvestRating: number | null;
  goodreadsHarvestRating: number | null;
  romanceIoHarvestSpice: number | null;
  isJunk: boolean;
  isFocused: boolean;
};

type BookRecord = {
  id: string;
  title: string;
  author: string;
  amazon_asin: string | null;
  goodreads_id: string | null;
  isbn13: string | null;
  romance_io_slug: string | null;
  is_canon: boolean | null;
  enrichment_status: string | null;
};

type RatingRecord = {
  book_id: string;
  source: string;
  rating: number | null;
  rating_count: number | null;
};

type SpiceRecord = {
  book_id: string;
  source: string;
  spice_value: number | null;
  confidence: number | null;
};

type AuditRow = {
  rank: number;
  inputTitle: string;
  inputAuthor: string;
  inputSource: string;
  asin: string | null;
  matched: boolean;
  matchMethod: string | null;
  bookId: string | null;
  dbTitle: string | null;
  dbAuthor: string | null;
  canon: boolean | null;
  enrichmentStatus: string | null;
  isJunk: boolean;
  isFocused: boolean;
  hasGoodreadsId: boolean;
  hasAmazonRating: boolean;
  hasGoodreadsRating: boolean;
  hasRomanceIoSpice: boolean;
  amazonRating: number | null;
  goodreadsRating: number | null;
  romanceIoSpice: number | null;
  amazonHarvestRating: number | null;
  goodreadsHarvestRating: number | null;
  romanceIoHarvestSpice: number | null;
  action: string;
  priority: "P0" | "P1" | "P2" | "P3";
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: npm run audit:top-list -- <path-to-csv>");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function parseCSV(text: string): CsvRow[] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      current.push(field);
      field = "";
    } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
      current.push(field);
      field = "";
      if (current.some((f) => f.trim())) rows.push(current);
      current = [];
      if (ch === "\r") i++;
    } else {
      field += ch;
    }
  }

  current.push(field);
  if (current.some((f) => f.trim())) rows.push(current);
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const obj: CsvRow = {};
    headers.forEach((header, index) => {
      obj[header] = (row[index] ?? "").trim();
    });
    return obj;
  });
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(the|a|an)\s+/, "")
    .trim();
}

function normalizeAuthor(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRomanceIoSlug(value?: string | null): string | null {
  if (!value) return null;
  return value.split("/").filter(Boolean)[0] || null;
}

function toHarvestRows(rows: CsvRow[]): HarvestRow[] {
  return rows
    .map((row, index) => {
      const title = row.title || row.Title || "";
      const author = row.author || row.Author || "";
      const source = row.source || row.Source || "csv_import";
      const romanceIoSlug = normalizeRomanceIoSlug(
        row.romanceIoSlug || row.romanceio_slug || null
      );

      return {
        rank: index + 1,
        title,
        author,
        source,
        asin: row.asin || row.ASIN || null,
        goodreadsId:
          row.goodreadsId || row.goodreads_id || row.GoodreadsID || null,
        isbn13: row.isbn13 || row.ISBN13 || null,
        romanceIoSlug,
        amazonHarvestRating: parseNumber(
          row.amazonRating || row.amazon_rating || row.AmazonRating
        ),
        goodreadsHarvestRating: parseNumber(
          row.goodreadsRating || row.goodreads_rating || row.GoodreadsRating
        ),
        romanceIoHarvestSpice: parseNumber(
          row.romanceIoSpice || row.romanceio_spice || row.Spice
        ),
        isJunk: isJunkTitle(title, author),
        isFocused: isRomantasyDiscoveryCandidate({
          title,
          author,
          context: source,
        }),
      };
    })
    .filter((row) => row.title && row.author);
}

async function fetchBooksBy(
  column: keyof Pick<
    BookRecord,
    "amazon_asin" | "goodreads_id" | "isbn13" | "romance_io_slug"
  >,
  values: string[]
): Promise<BookRecord[]> {
  const uniqueValues = Array.from(new Set(values.filter(Boolean)));
  if (uniqueValues.length === 0) return [];

  const { data, error } = await supabase
    .from("books")
    .select(
      "id,title,author,amazon_asin,goodreads_id,isbn13,romance_io_slug,is_canon,enrichment_status"
    )
    .in(column, uniqueValues);

  if (error) throw error;
  return (data ?? []) as BookRecord[];
}

async function findByTitleAuthor(row: HarvestRow): Promise<BookRecord | null> {
  const authorLastName = row.author.trim().split(/\s+/).pop();
  if (!authorLastName) return null;

  const select =
    "id,title,author,amazon_asin,goodreads_id,isbn13,romance_io_slug,is_canon,enrichment_status";
  const inputTitle = normalizeTitle(row.title);
  const inputAuthor = normalizeAuthor(row.author);
  const candidates: BookRecord[] = [];

  const { data: titleMatches, error: titleError } = await supabase
    .from("books")
    .select(select)
    .ilike("title", row.title)
    .limit(10);

  if (titleError) throw titleError;
  candidates.push(...((titleMatches ?? []) as BookRecord[]));

  const titleWords = inputTitle
    .split(" ")
    .filter((word) => word.length >= 4)
    .slice(0, 5);
  if (titleWords.length > 0) {
    const { data: titleWordMatches, error: titleWordError } = await supabase
      .from("books")
      .select(select)
      .ilike("title", `%${titleWords.join("%")}%`)
      .limit(20);

    if (titleWordError) throw titleWordError;
    candidates.push(...((titleWordMatches ?? []) as BookRecord[]));
  }

  const { data: authorMatches, error: authorError } = await supabase
    .from("books")
    .select(select)
    .ilike("author", `%${authorLastName}%`)
    .limit(50);

  if (authorError) throw authorError;
  candidates.push(...((authorMatches ?? []) as BookRecord[]));

  const uniqueCandidates = Array.from(
    new Map(candidates.map((candidate) => [candidate.id, candidate])).values()
  );
  return (
    uniqueCandidates.find((book) => {
      const dbTitle = normalizeTitle(book.title);
      const dbAuthor = normalizeAuthor(book.author);
      return (
        dbAuthor === inputAuthor &&
        (dbTitle === inputTitle ||
          (dbTitle.length >= 8 && inputTitle.startsWith(dbTitle)) ||
          (inputTitle.length >= 8 && dbTitle.startsWith(inputTitle)))
      );
    }) ?? null
  );
}

function indexBooks(books: BookRecord[], column: keyof BookRecord): Map<string, BookRecord> {
  const map = new Map<string, BookRecord>();
  for (const book of books) {
    const value = book[column];
    if (typeof value === "string" && value && !map.has(value)) {
      map.set(value, book);
    }
  }
  return map;
}

function chooseAction(row: AuditRow): Pick<AuditRow, "action" | "priority"> {
  if (row.isJunk) {
    return { action: "skip_junk", priority: "P3" };
  }
  if (!row.isFocused) {
    return { action: "skip_out_of_focus", priority: "P3" };
  }
  if (!row.matched) {
    return { action: "add_or_resolve_book", priority: row.rank <= 50 ? "P0" : "P1" };
  }
  if (!row.canon && row.rank <= 50) {
    return { action: "review_for_canon_promotion", priority: "P0" };
  }
  if (!row.hasGoodreadsId || !row.hasGoodreadsRating) {
    return { action: "resolve_goodreads_identity", priority: row.rank <= 75 ? "P0" : "P1" };
  }
  if (!row.hasRomanceIoSpice) {
    return { action: "refresh_romance_io_spice", priority: row.rank <= 75 ? "P0" : "P1" };
  }
  if (!row.hasAmazonRating) {
    return { action: "save_or_refresh_amazon_rating", priority: "P1" };
  }
  if (!row.canon) {
    return { action: "review_for_canon_promotion", priority: "P1" };
  }
  return { action: "covered", priority: "P3" };
}

function toCsvValue(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows: AuditRow[]): string {
  const headers = [
    "rank",
    "priority",
    "action",
    "inputTitle",
    "inputAuthor",
    "inputSource",
    "asin",
    "matched",
    "matchMethod",
    "canon",
    "enrichmentStatus",
    "hasGoodreadsId",
    "hasGoodreadsRating",
    "hasAmazonRating",
    "hasRomanceIoSpice",
    "amazonHarvestRating",
    "goodreadsHarvestRating",
    "romanceIoHarvestSpice",
    "bookId",
    "dbTitle",
    "dbAuthor",
    "isJunk",
    "isFocused",
  ] satisfies Array<keyof AuditRow>;

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => toCsvValue(row[header])).join(",")),
  ].join("\n");
}

async function main() {
  const input = readFileSync(csvPath, "utf8");
  const csvRows = parseCSV(input);
  const harvestRows = toHarvestRows(csvRows);

  const [asinBooks, goodreadsBooks, isbnBooks, romanceIoBooks] = await Promise.all([
    fetchBooksBy(
      "amazon_asin",
      harvestRows.map((row) => row.asin).filter((value): value is string => Boolean(value))
    ),
    fetchBooksBy(
      "goodreads_id",
      harvestRows
        .map((row) => row.goodreadsId)
        .filter((value): value is string => Boolean(value))
    ),
    fetchBooksBy(
      "isbn13",
      harvestRows.map((row) => row.isbn13).filter((value): value is string => Boolean(value))
    ),
    fetchBooksBy(
      "romance_io_slug",
      harvestRows
        .map((row) => row.romanceIoSlug)
        .filter((value): value is string => Boolean(value))
    ),
  ]);

  const byAsin = indexBooks(asinBooks, "amazon_asin");
  const byGoodreads = indexBooks(goodreadsBooks, "goodreads_id");
  const byIsbn = indexBooks(isbnBooks, "isbn13");
  const byRomanceIo = indexBooks(romanceIoBooks, "romance_io_slug");

  const matched = new Map<number, { book: BookRecord; method: string }>();
  for (const row of harvestRows) {
    const match =
      (row.asin && byAsin.get(row.asin) && { book: byAsin.get(row.asin)!, method: "asin" }) ||
      (row.goodreadsId &&
        byGoodreads.get(row.goodreadsId) && {
          book: byGoodreads.get(row.goodreadsId)!,
          method: "goodreads_id",
        }) ||
      (row.isbn13 && byIsbn.get(row.isbn13) && { book: byIsbn.get(row.isbn13)!, method: "isbn13" }) ||
      (row.romanceIoSlug &&
        byRomanceIo.get(row.romanceIoSlug) && {
          book: byRomanceIo.get(row.romanceIoSlug)!,
          method: "romance_io_slug",
        }) ||
      null;

    if (match) matched.set(row.rank, match);
  }

  for (const row of harvestRows) {
    if (matched.has(row.rank) || row.isJunk) continue;
    const titleAuthorMatch = await findByTitleAuthor(row);
    if (titleAuthorMatch) {
      matched.set(row.rank, { book: titleAuthorMatch, method: "title_author" });
    }
  }

  const matchedBookIds = Array.from(
    new Set(Array.from(matched.values()).map((match) => match.book.id))
  );

  const [{ data: ratingData, error: ratingError }, { data: spiceData, error: spiceError }] =
    await Promise.all([
      matchedBookIds.length
        ? supabase
            .from("book_ratings")
            .select("book_id,source,rating,rating_count")
            .in("book_id", matchedBookIds)
        : Promise.resolve({ data: [], error: null }),
      matchedBookIds.length
        ? supabase
            .from("spice_signals")
            .select("book_id,source,spice_value,confidence")
            .in("book_id", matchedBookIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (ratingError) throw ratingError;
  if (spiceError) throw spiceError;

  const ratingsByBook = new Map<string, Record<string, RatingRecord>>();
  for (const rating of (ratingData ?? []) as RatingRecord[]) {
    const existing = ratingsByBook.get(rating.book_id) ?? {};
    existing[rating.source] = rating;
    ratingsByBook.set(rating.book_id, existing);
  }

  const spiceByBook = new Map<string, Record<string, SpiceRecord>>();
  for (const spice of (spiceData ?? []) as SpiceRecord[]) {
    const existing = spiceByBook.get(spice.book_id) ?? {};
    existing[spice.source] = spice;
    spiceByBook.set(spice.book_id, existing);
  }

  const auditRows: AuditRow[] = harvestRows.map((row) => {
    const match = matched.get(row.rank);
    const book = match?.book ?? null;
    const ratings = book ? ratingsByBook.get(book.id) ?? {} : {};
    const spices = book ? spiceByBook.get(book.id) ?? {} : {};

    const auditRow: AuditRow = {
      rank: row.rank,
      inputTitle: row.title,
      inputAuthor: row.author,
      inputSource: row.source,
      asin: row.asin,
      matched: Boolean(book),
      matchMethod: match?.method ?? null,
      bookId: book?.id ?? null,
      dbTitle: book?.title ?? null,
      dbAuthor: book?.author ?? null,
      canon: book?.is_canon ?? null,
      enrichmentStatus: book?.enrichment_status ?? null,
      isJunk: row.isJunk,
      isFocused: row.isFocused,
      hasGoodreadsId: Boolean(book?.goodreads_id),
      hasAmazonRating: Boolean(ratings.amazon?.rating),
      hasGoodreadsRating: Boolean(ratings.goodreads?.rating),
      hasRomanceIoSpice: Boolean(spices.romance_io?.spice_value),
      amazonRating: ratings.amazon?.rating ?? null,
      goodreadsRating: ratings.goodreads?.rating ?? null,
      romanceIoSpice: spices.romance_io?.spice_value ?? null,
      amazonHarvestRating: row.amazonHarvestRating,
      goodreadsHarvestRating: row.goodreadsHarvestRating,
      romanceIoHarvestSpice: row.romanceIoHarvestSpice,
      action: "covered",
      priority: "P3",
    };

    return { ...auditRow, ...chooseAction(auditRow) };
  });

  const actionableRows = auditRows.filter(
    (row) => row.priority !== "P3" && row.action !== "covered"
  );
  const summary = {
    sourceFile: csvPath,
    generatedAt: new Date().toISOString(),
    rawRows: csvRows.length,
    auditedRows: harvestRows.length,
    junkRows: auditRows.filter((row) => row.isJunk).length,
    outOfFocusRows: auditRows.filter((row) => !row.isJunk && !row.isFocused).length,
    matchedRows: auditRows.filter((row) => row.matched).length,
    missingRows: auditRows.filter((row) => !row.isJunk && row.isFocused && !row.matched).length,
    nonCanonMatchedRows: auditRows.filter((row) => row.matched && row.canon === false).length,
    missingGoodreadsIdRows: auditRows.filter((row) => row.matched && !row.hasGoodreadsId).length,
    missingGoodreadsRatingRows: auditRows.filter(
      (row) => row.matched && !row.hasGoodreadsRating
    ).length,
    missingAmazonRatingRows: auditRows.filter((row) => row.matched && !row.hasAmazonRating).length,
    missingRomanceIoSpiceRows: auditRows.filter(
      (row) => row.matched && !row.hasRomanceIoSpice
    ).length,
    p0Rows: actionableRows.filter((row) => row.priority === "P0").length,
    p1Rows: actionableRows.filter((row) => row.priority === "P1").length,
    p2Rows: actionableRows.filter((row) => row.priority === "P2").length,
  };

  const report = {
    summary,
    topActions: actionableRows.slice(0, 50),
    rows: auditRows,
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = basename(csvPath).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const outputDir = join(process.cwd(), "scripts", "audit-reports");
  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, `top-list-coverage-${safeName}-${stamp}.json`);
  const csvOutPath = join(outputDir, `top-list-coverage-${safeName}-${stamp}.csv`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(csvOutPath, `${toCsv(auditRows)}\n`);

  console.log(JSON.stringify(summary, null, 2));
  console.log("\nTop actions:");
  for (const row of actionableRows.slice(0, 20)) {
    console.log(
      `  ${row.priority} #${row.rank} ${row.action}: ${row.inputTitle} by ${row.inputAuthor}`
    );
  }
  console.log(`\nWrote:\n  ${jsonPath}\n  ${csvOutPath}`);
}

main().catch((error) => {
  console.error("[top-list-audit] Fatal error:", error);
  process.exit(1);
});
