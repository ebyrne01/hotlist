/**
 * Step 1: Export catalog for Goodreads bulk enrichment.
 *
 * Generates a JSON file of Goodreads URLs to feed to the epctex/goodreads-scraper actor.
 * Three tiers:
 *   Tier 1 — Has Goodreads URL/ID → direct book page URL
 *   Tier 2 — Has ISBN but no GR ID → search URL with ISBN
 *   Tier 3 — Title+Author only → search URL with title+author
 *
 * Usage:
 *   npx tsx scripts/goodreads-enrichment/export-catalog.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "fs";
import { join } from "path";
import { getAdminClient } from "@/lib/supabase/admin";

const OUT_DIR = join(__dirname);

interface ExportedBook {
  id: string;
  title: string;
  author: string;
  tier: 1 | 2 | 3;
  goodreads_id: string | null;
  goodreads_url: string | null;
  scrape_url: string; // URL to feed to the actor
}

async function main() {
  const supabase = getAdminClient();

  console.log("=== Goodreads Enrichment: Export Catalog ===\n");

  // Fetch all books
  const PAGE_SIZE = 1000;
  const allBooks: ExportedBook[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("books")
      .select("id, title, author, goodreads_id, goodreads_url, isbn, isbn13")
      .range(offset, offset + PAGE_SIZE - 1)
      .order("id");

    if (error) {
      console.error("Query error:", error.message);
      break;
    }
    if (!data || data.length === 0) break;

    for (const book of data) {
      let tier: 1 | 2 | 3;
      let scrapeUrl: string;

      if (book.goodreads_url || book.goodreads_id) {
        tier = 1;
        // Use the stored URL, or construct from ID
        scrapeUrl = book.goodreads_url
          || `https://www.goodreads.com/book/show/${book.goodreads_id}`;
      } else if (book.isbn13 || book.isbn) {
        tier = 2;
        const isbn = book.isbn13 || book.isbn;
        scrapeUrl = `https://www.goodreads.com/search?q=${isbn}`;
      } else {
        tier = 3;
        const query = `${book.title} ${book.author}`.trim();
        scrapeUrl = `https://www.goodreads.com/search?q=${encodeURIComponent(query)}`;
      }

      allBooks.push({
        id: book.id,
        title: book.title,
        author: book.author,
        tier,
        goodreads_id: book.goodreads_id,
        goodreads_url: book.goodreads_url,
        scrape_url: scrapeUrl,
      });
    }

    offset += data.length;
    if (data.length < PAGE_SIZE) break;
  }

  // Stats
  const tier1 = allBooks.filter((b) => b.tier === 1);
  const tier2 = allBooks.filter((b) => b.tier === 2);
  const tier3 = allBooks.filter((b) => b.tier === 3);

  console.log(`Total books: ${allBooks.length}`);
  console.log(`  Tier 1 (GR URL/ID): ${tier1.length}`);
  console.log(`  Tier 2 (ISBN only):  ${tier2.length}`);
  console.log(`  Tier 3 (title only): ${tier3.length}`);

  // Write files
  writeFileSync(join(OUT_DIR, "catalog-all.json"), JSON.stringify(allBooks, null, 2));
  writeFileSync(join(OUT_DIR, "catalog-tier1.json"), JSON.stringify(tier1, null, 2));
  writeFileSync(join(OUT_DIR, "catalog-tier2.json"), JSON.stringify(tier2, null, 2));
  writeFileSync(join(OUT_DIR, "catalog-tier3.json"), JSON.stringify(tier3, null, 2));

  // Also write a flat list of just URLs for quick reference
  const urls = allBooks.map((b) => b.scrape_url);
  writeFileSync(join(OUT_DIR, "urls.json"), JSON.stringify(urls, null, 2));

  console.log(`\nFiles written to ${OUT_DIR}/`);
  console.log("  catalog-all.json, catalog-tier1.json, catalog-tier2.json, catalog-tier3.json, urls.json");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
