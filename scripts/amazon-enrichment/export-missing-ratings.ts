/**
 * Step 1: Export books missing Amazon ratings
 *
 * Queries Supabase for books without Amazon rating data and splits them into
 * three files based on available identifiers:
 *   - books-with-asin.json  (ASIN → direct lookup)
 *   - books-with-isbn.json  (ISBN → Amazon search by ISBN)
 *   - books-title-only.json (title+author → fuzzy search)
 *
 * Usage:
 *   npx tsx scripts/amazon-enrichment/export-missing-ratings.ts [--dry-run]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { join } from "path";

const DRY_RUN = process.argv.includes("--dry-run");
const OUT_DIR = join(__dirname);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface BookRow {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  amazon_asin: string | null;
  goodreads_id: string | null;
  google_books_id: string | null;
}

async function main() {
  console.log("=== Amazon Enrichment: Export Missing Ratings ===\n");

  // Total books in DB
  const { count: totalBooks } = await supabase
    .from("books")
    .select("*", { count: "exact", head: true });

  // Books that already have Amazon ratings
  const { data: ratedBookIds } = await supabase
    .from("book_ratings")
    .select("book_id")
    .eq("source", "amazon");
  const ratedSet = new Set((ratedBookIds ?? []).map((r) => r.book_id));

  // Books with ASINs
  const { count: asinCount } = await supabase
    .from("books")
    .select("*", { count: "exact", head: true })
    .not("amazon_asin", "is", null);

  // Books with ISBNs
  const { count: isbnCount } = await supabase
    .from("books")
    .select("*", { count: "exact", head: true })
    .not("isbn", "is", null);

  console.log(`Total books in DB:        ${totalBooks}`);
  console.log(`Books with Amazon rating: ${ratedSet.size}`);
  console.log(`Books missing rating:     ${(totalBooks ?? 0) - ratedSet.size}`);
  console.log(`Books with ASINs:         ${asinCount}`);
  console.log(`Books with ISBNs:         ${isbnCount}`);
  console.log();

  if (DRY_RUN) {
    console.log("[dry-run] Exiting before file export.");
    return;
  }

  // Fetch all books — paginate in chunks of 1000
  const allBooks: BookRow[] = [];
  let offset = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("books")
      .select("id, title, author, isbn, amazon_asin, goodreads_id, google_books_id")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    allBooks.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // Split into categories: only books MISSING Amazon ratings
  const withAsin: BookRow[] = [];
  const withIsbn: BookRow[] = [];
  const titleOnly: BookRow[] = [];

  for (const book of allBooks) {
    if (ratedSet.has(book.id)) continue; // Already has Amazon rating

    if (book.amazon_asin) {
      withAsin.push(book);
    } else if (book.isbn) {
      withIsbn.push(book);
    } else {
      titleOnly.push(book);
    }
  }

  console.log("--- Books to enrich ---");
  console.log(`With ASIN (direct lookup):     ${withAsin.length}`);
  console.log(`With ISBN (Amazon search):      ${withIsbn.length}`);
  console.log(`Title+Author only (fuzzy):      ${titleOnly.length}`);
  console.log(`Total to enrich:                ${withAsin.length + withIsbn.length + titleOnly.length}`);

  // Write output files
  const write = (name: string, data: BookRow[]) => {
    const path = join(OUT_DIR, name);
    writeFileSync(path, JSON.stringify(data, null, 2));
    console.log(`\nWrote ${data.length} books to ${name}`);
  };

  write("books-with-asin.json", withAsin);
  write("books-with-isbn.json", withIsbn);
  write("books-title-only.json", titleOnly);

  // Combined file for reference
  const all = [...withAsin, ...withIsbn, ...titleOnly];
  write("books-to-enrich.json", all);

  console.log("\nDone! Run fetch-amazon-ratings.ts next.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
