/**
 * MASS ENRICHMENT SCRIPT
 *
 * Enriches all books in the database with:
 * - Goodreads ratings (scraped)
 * - Amazon ratings (scraped)
 * - Spice levels (romance.io + Goodreads shelf inference)
 *
 * Processes books that are missing Goodreads ratings.
 * Rate-limited: batches of 5 with 5s delays (Goodreads is strict).
 *
 * Usage: npm run enrich:books
 *        npx tsx scripts/enrich-books.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { enrichBookWithExternalData } from "../lib/scraping";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 5000;

async function main() {
  console.log("🔥 Hotlist Mass Enrichment");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Missing env vars");
    process.exit(1);
  }

  const supabase = getAdminClient();

  // Find all books
  const { data: books } = await supabase
    .from("books")
    .select("id, title, author, isbn, goodreads_id")
    .not("goodreads_id", "like", "unknown-%")
    .order("created_at", { ascending: false });

  if (!books || books.length === 0) {
    console.log("No books found.");
    return;
  }

  // Find which already have Goodreads ratings
  const bookIds = books.map((b) => b.id);

  // Query in chunks of 500 (Supabase IN limit)
  const hasRating = new Set<string>();
  for (let i = 0; i < bookIds.length; i += 500) {
    const chunk = bookIds.slice(i, i + 500);
    const { data: existingRatings } = await supabase
      .from("book_ratings")
      .select("book_id")
      .in("book_id", chunk)
      .eq("source", "goodreads")
      .not("rating", "is", null);

    for (const r of existingRatings ?? []) {
      hasRating.add(r.book_id);
    }
  }

  const needsEnrichment = books.filter((b) => !hasRating.has(b.id));

  console.log(`Total books: ${books.length}`);
  console.log(`Already enriched: ${hasRating.size}`);
  console.log(`Need enrichment: ${needsEnrichment.length}`);
  console.log(`Batch size: ${BATCH_SIZE}, delay: ${BATCH_DELAY_MS}ms`);
  console.log(`Started at ${new Date().toLocaleString()}\n`);

  let enriched = 0;
  let failed = 0;

  for (let i = 0; i < needsEnrichment.length; i += BATCH_SIZE) {
    const batch = needsEnrichment.slice(i, i + BATCH_SIZE);

    // Process batch sequentially (each book makes multiple HTTP requests)
    for (const book of batch) {
      try {
        console.log(`[${i + batch.indexOf(book) + 1}/${needsEnrichment.length}] "${book.title}" — ${book.author}`);
        const result = await enrichBookWithExternalData(
          book.id,
          book.title,
          book.author,
          book.isbn
        );

        const sources = [
          result.goodreads ? `GR: ${result.goodreads.rating}` : null,
          result.amazon ? `AMZ: ${result.amazon.rating}` : null,
          result.spice.level ? `Spice: ${result.spice.level}/5` : null,
        ].filter(Boolean);

        if (sources.length > 0) {
          console.log(`  ✓ ${sources.join(", ")}`);
          enriched++;
        } else {
          console.log(`  — No data found`);
        }
      } catch (err) {
        console.warn(`  ✗ Error:`, err);
        failed++;
      }
    }

    // Pause between batches
    if (i + BATCH_SIZE < needsEnrichment.length) {
      console.log(`  ... pausing (${Math.min(i + BATCH_SIZE, needsEnrichment.length)}/${needsEnrichment.length})\n`);
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 ENRICHMENT COMPLETE");
  console.log(`  Enriched: ${enriched}`);
  console.log(`  No data:  ${needsEnrichment.length - enriched - failed}`);
  console.log(`  Failed:   ${failed}`);
  console.log(`Finished at ${new Date().toLocaleString()}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
