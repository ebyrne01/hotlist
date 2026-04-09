/**
 * Import romantasy bestseller data from spreadsheet into Supabase.
 *
 * For books already in DB: upserts Amazon ratings + fills missing ISBNs
 * For books NOT in DB: creates provisional records + queues enrichment
 *
 * Usage:
 *   npx tsx scripts/amazon-enrichment/import-bestseller-spreadsheet.ts
 *   npx tsx scripts/amazon-enrichment/import-bestseller-spreadsheet.ts --dry-run
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import * as XLSX from "xlsx";
import { getAdminClient } from "@/lib/supabase/admin";
import { queueEnrichmentJobs } from "@/lib/enrichment/queue";

const DRY_RUN = process.argv.includes("--dry-run");

interface SpreadsheetRow {
  Rank: number;
  Title: string;
  Author: string;
  "Amazon Rating"?: number;
  "Amazon Reviews"?: number;
  "Goodreads Rating"?: number;
  "ISBN-13"?: string;
  Series?: string;
  Source?: string;
}

async function main() {
  const wb = XLSX.readFile("/Users/erinstreeter/Downloads/hotlist-romantasy-bestsellers.xlsx");
  const raw = XLSX.utils.sheet_to_json<SpreadsheetRow>(wb.Sheets[wb.SheetNames[0]]);
  const books = raw.filter((r) => typeof r.Title === "string" && typeof r.Rank === "number");

  console.log(`=== Bestseller Spreadsheet Import${DRY_RUN ? " (DRY RUN)" : ""} ===`);
  console.log(`Books in spreadsheet: ${books.length}\n`);

  const supabase = getAdminClient();

  let matched = 0;
  let notFound = 0;
  let ratingsUpserted = 0;
  let isbnsFilled = 0;
  let booksCreated = 0;

  const notFoundBooks: { title: string; author: string }[] = [];

  for (const row of books) {
    const title = row.Title.trim();
    const author = row.Author.trim();
    const amzRating = row["Amazon Rating"];
    const amzReviews = row["Amazon Reviews"];
    const isbn13 = row["ISBN-13"]?.toString().trim() || null;
    const seriesRaw = row.Series?.trim() || null;

    // Parse series name and position from "Series Name #N" format
    let seriesName: string | null = null;
    let seriesPosition: number | null = null;
    if (seriesRaw) {
      const match = seriesRaw.match(/^(.+?)\s*#(\d+)$/);
      if (match) {
        seriesName = match[1].trim();
        seriesPosition = parseInt(match[2], 10);
      } else {
        seriesName = seriesRaw;
      }
    }

    // Try to find the book in DB — first by exact title, then by fuzzy
    const { data: exactMatch } = await supabase
      .from("books")
      .select("id, title, author, isbn13, series_name, series_position")
      .ilike("title", title)
      .limit(1)
      .single();

    let bookId: string | null = exactMatch?.id ?? null;

    // If no exact match, try ISBN
    let isbnMatchData: typeof exactMatch = null;
    if (!bookId && isbn13) {
      const { data: isbnMatch } = await supabase
        .from("books")
        .select("id, title, author, isbn13, series_name, series_position")
        .eq("isbn13", isbn13)
        .limit(1)
        .single();
      if (isbnMatch) {
        bookId = isbnMatch.id;
        isbnMatchData = isbnMatch;
      }
    }

    if (bookId) {
      matched++;
      const book = exactMatch ?? isbnMatchData!;

      // Upsert Amazon rating if we have one
      if (amzRating && amzRating > 0) {
        if (!DRY_RUN) {
          await supabase.from("book_ratings").upsert(
            {
              book_id: bookId,
              source: "amazon",
              rating: amzRating,
              rating_count: amzReviews ?? null,
              scraped_at: new Date().toISOString(),
            },
            { onConflict: "book_id,source" }
          );
        }
        ratingsUpserted++;
      }

      // Fill missing ISBN
      if (isbn13 && !book.isbn13) {
        if (!DRY_RUN) {
          await supabase.from("books").update({ isbn13 }).eq("id", bookId);
        }
        isbnsFilled++;
      }

      // Fill missing series info
      if (seriesName && !book.series_name) {
        if (!DRY_RUN) {
          await supabase.from("books").update({
            series_name: seriesName,
            series_position: seriesPosition,
          }).eq("id", bookId);
        }
      }

      console.log(`  ✓ MATCH: "${title}" by ${author}${amzRating ? ` → AMZ ${amzRating}` : ""}`);
    } else {
      notFound++;
      notFoundBooks.push({ title, author });

      // Create a provisional book record
      if (!DRY_RUN) {
        const slug = title
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/\s+/g, "-")
          .slice(0, 80);

        const { data: newBook, error } = await supabase
          .from("books")
          .insert({
            title,
            author,
            isbn13: isbn13 || null,
            series_name: seriesName,
            series_position: seriesPosition,
            slug,
            enrichment_status: "pending",
          })
          .select("id")
          .single();

        if (newBook) {
          booksCreated++;

          // Upsert Amazon rating
          if (amzRating && amzRating > 0) {
            await supabase.from("book_ratings").upsert(
              {
                book_id: newBook.id,
                source: "amazon",
                rating: amzRating,
                rating_count: amzReviews ?? null,
                scraped_at: new Date().toISOString(),
              },
              { onConflict: "book_id,source" }
            );
            ratingsUpserted++;
          }

          // Queue enrichment (will resolve Goodreads ID, cover, etc.)
          await queueEnrichmentJobs(newBook.id, title, author);

          console.log(`  + NEW: "${title}" by ${author} → created + enrichment queued`);
        } else {
          console.warn(`  ✗ FAIL: "${title}" — ${error?.message}`);
        }
      } else {
        console.log(`  ? NOT FOUND: "${title}" by ${author}`);
      }
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Total books:       ${books.length}`);
  console.log(`Matched in DB:     ${matched}`);
  console.log(`Not found:         ${notFound}`);
  console.log(`Ratings upserted:  ${ratingsUpserted}`);
  console.log(`ISBNs filled:      ${isbnsFilled}`);
  console.log(`Books created:     ${booksCreated}`);

  if (notFoundBooks.length > 0 && DRY_RUN) {
    console.log("\nBooks not in DB:");
    notFoundBooks.forEach((b) => console.log(`  - "${b.title}" by ${b.author}`));
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
