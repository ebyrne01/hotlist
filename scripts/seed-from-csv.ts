/**
 * SEED FROM CSV
 *
 * Thin CLI wrapper that reads a CSV file exported by the Book Harvester
 * extension and POSTs it to the harvest API endpoint.
 *
 *   npx tsx scripts/seed-from-csv.ts <path-to-csv>
 *
 * Uses CRON_SECRET for authentication (no browser session needed).
 */

import "dotenv/config";
import { readFileSync } from "fs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET;

if (!CRON_SECRET) {
  console.error("Missing CRON_SECRET environment variable");
  process.exit(1);
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: npx tsx scripts/seed-from-csv.ts <path-to-csv>");
  process.exit(1);
}

// ── CSV parser (handles quoted fields with commas/newlines) ──

function parseCSV(text: string): Record<string, string>[] {
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
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        current.push(field);
        field = "";
      } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
        current.push(field);
        field = "";
        if (current.some((f) => f.trim())) rows.push(current);
        current = [];
        if (ch === "\r") i++; // skip \n after \r
      } else {
        field += ch;
      }
    }
  }
  // Last row
  current.push(field);
  if (current.some((f) => f.trim())) rows.push(current);

  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (row[i] ?? "").trim();
    });
    return obj;
  });
}

// ── Map CSV row to harvest book schema ──

function toHarvestBook(row: Record<string, string>) {
  const parseNum = (v: string | undefined) => {
    if (!v) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };
  const parseInt_ = (v: string | undefined) => {
    if (!v) return null;
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  };

  return {
    title: row.title || row.Title || "",
    author: row.author || row.Author || "",
    isbn13: row.isbn13 || row.ISBN13 || null,
    goodreadsId: row.goodreadsId || row.GoodreadsID || null,
    asin: row.asin || row.ASIN || null,
    seriesName: row.seriesName || row.Series || null,
    seriesPosition: parseInt_(row.seriesPosition || row.SeriesPosition),
    coverUrl: row.coverUrl || row.CoverURL || null,
    goodreadsRating: parseNum(row.goodreadsRating || row.GoodreadsRating),
    goodreadsRatingCount: parseInt_(row.goodreadsRatingCount || row.GoodreadsRatingCount),
    amazonRating: parseNum(row.amazonRating || row.AmazonRating),
    amazonRatingCount: parseInt_(row.amazonRatingCount || row.AmazonRatingCount),
    romanceIoSpice: parseInt_(row.romanceIoSpice || row.Spice),
    format: row.format || row.Format || null,
    source: row.source || row.Source || "csv_import",
  };
}

// ── Main ──

async function main() {
  console.log(`[seed-csv] Reading ${csvPath}...`);
  const raw = readFileSync(csvPath, "utf-8");
  const rows = parseCSV(raw);

  if (rows.length === 0) {
    console.error("[seed-csv] No data rows found in CSV");
    process.exit(1);
  }

  const books = rows
    .map(toHarvestBook)
    .filter((b) => b.title && b.author);

  console.log(`[seed-csv] Parsed ${books.length} books from ${rows.length} rows`);

  // POST to harvest endpoint
  const url = `${APP_URL}/api/seed/harvest`;
  console.log(`[seed-csv] Uploading to ${url}...`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CRON_SECRET}`,
    },
    body: JSON.stringify({ books }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[seed-csv] Upload failed (${res.status}):`, text);
    process.exit(1);
  }

  const result = await res.json();
  console.log(`\n[seed-csv] ✓ Harvest complete`);
  console.log(`  Added:    ${result.added}`);
  console.log(`  Updated:  ${result.updated}`);
  console.log(`  Skipped:  ${result.skipped}`);
  if (result.skippedAudiobooks > 0) console.log(`  Audiobooks skipped: ${result.skippedAudiobooks}`);
  if (result.skippedJunk > 0) console.log(`  Junk skipped: ${result.skippedJunk}`);
  console.log(`  Enrichment jobs queued: ${result.enrichmentJobsQueued}`);

  if (result.details?.newBooks?.length > 0) {
    console.log(`\n  New books:`);
    for (const b of result.details.newBooks.slice(0, 20)) {
      console.log(`    + ${b}`);
    }
    if (result.details.newBooks.length > 20) {
      console.log(`    ... and ${result.details.newBooks.length - 20} more`);
    }
  }
}

main().catch((err) => {
  console.error("[seed-csv] Fatal error:", err);
  process.exit(1);
});
