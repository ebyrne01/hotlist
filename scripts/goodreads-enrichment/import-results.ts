/**
 * Step 3: Import Goodreads enrichment results into Supabase.
 *
 * Reads goodreads-results.json and:
 *   1. Upserts Goodreads ratings into book_ratings
 *   2. Fills missing metadata on books (description, cover, page count, ISBN, series, publisher)
 *   3. Updates goodreads_id/goodreads_url for Tier 2/3 books that resolved
 *   4. Extracts Amazon ASINs from buyLinks
 *
 * Usage:
 *   npx tsx scripts/goodreads-enrichment/import-results.ts --dry-run
 *   npx tsx scripts/goodreads-enrichment/import-results.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getAdminClient } from "@/lib/supabase/admin";

const DRY_RUN = process.argv.includes("--dry-run");
const OUT_DIR = join(__dirname);

interface GoodreadsResult {
  bookId?: number;
  url?: string;
  title?: string;
  authorName?: string;
  rating?: number;
  numberOfRatings?: number;
  numberOfReviews?: number;
  description?: string;
  image?: string;
  numberOfPages?: number;
  ISBN?: string;
  Series?: string;
  firstPublishedDate?: string;
  publishedBy?: string;
  bookFormat?: string;
  buyLinks?: string[];
  _catalogBookId?: string;
  _tier?: number;
}

interface CatalogBook {
  id: string;
  title: string;
  author: string;
  tier: 1 | 2 | 3;
  goodreads_id: string | null;
  scrape_url: string;
}

function extractAsin(buyLinks: string[]): string | null {
  for (const link of buyLinks) {
    // Match /dp/ASIN or /product/ASIN patterns from Amazon URLs
    const match = link.match(/amazon\.com.*?\/(?:dp|product|gp\/product)\/([A-Z0-9]{10})/i);
    if (match) return match[1];
  }
  return null;
}

function parseYear(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  // "May 5, 2015" or "2015" etc.
  const match = dateStr.match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

function cleanDescription(desc: string | undefined): string | null {
  if (!desc) return null;
  // Convert <br /> to newlines, strip other HTML
  return desc
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim() || null;
}

function parseSeriesPosition(series: string | undefined): { name: string; position: number | null } | null {
  if (!series) return null;
  // Actor returns just the series name without position number
  // e.g. "A Court of Thorns and Roses"
  return { name: series.trim(), position: null };
}

async function main() {
  const resultsPath = join(OUT_DIR, "goodreads-results.json");
  if (!existsSync(resultsPath)) {
    console.error("No results file found. Run run-enrichment.ts first!");
    process.exit(1);
  }

  const results: GoodreadsResult[] = JSON.parse(readFileSync(resultsPath, "utf-8"));
  console.log(`=== Goodreads Import${DRY_RUN ? " (DRY RUN)" : ""} ===`);
  console.log(`Results to import: ${results.length}\n`);

  // Load catalog for matching Tier 2/3 results back to books
  const catalogPath = join(OUT_DIR, "catalog-all.json");
  const catalog: CatalogBook[] = existsSync(catalogPath)
    ? JSON.parse(readFileSync(catalogPath, "utf-8"))
    : [];
  const catalogById = new Map(catalog.map((b) => [b.id, b]));
  const catalogByGrId = new Map(
    catalog.filter((b) => b.goodreads_id).map((b) => [b.goodreads_id!, b])
  );

  const supabase = getAdminClient();

  let ratingsUpserted = 0;
  let metadataUpdated = 0;
  let grIdsResolved = 0;
  let asinsFound = 0;
  let skipped = 0;
  let errors = 0;

  for (const result of results) {
    const grBookId = result.bookId ? String(result.bookId) : null;
    const grUrl = result.url ?? null;

    // Resolve which DB book this result belongs to
    let dbBookId: string | null = result._catalogBookId ?? null;

    if (!dbBookId && grBookId) {
      // Match by Goodreads ID
      const catalogEntry = catalogByGrId.get(grBookId);
      if (catalogEntry) {
        dbBookId = catalogEntry.id;
      } else {
        // Try DB lookup
        const { data } = await supabase
          .from("books")
          .select("id")
          .eq("goodreads_id", grBookId)
          .limit(1)
          .single();
        if (data) dbBookId = data.id;
      }
    }

    if (!dbBookId) {
      skipped++;
      continue;
    }

    try {
      // 1. Upsert Goodreads rating
      if (result.rating && result.rating > 0) {
        if (!DRY_RUN) {
          const { error } = await supabase.from("book_ratings").upsert(
            {
              book_id: dbBookId,
              source: "goodreads",
              rating: result.rating,
              rating_count: result.numberOfRatings ?? null,
              review_count: result.numberOfReviews ?? null,
              scraped_at: new Date().toISOString(),
            },
            { onConflict: "book_id,source" }
          );
          if (error) {
            console.warn(`  Rating upsert error for ${dbBookId}: ${error.message}`);
            errors++;
            continue;
          }
        }
        ratingsUpserted++;
      }

      // 2. Build metadata update (only fill missing fields)
      const { data: existingBook } = await supabase
        .from("books")
        .select("description, cover_url, page_count, isbn, isbn13, series_name, publisher, published_year, goodreads_id, goodreads_url, amazon_asin")
        .eq("id", dbBookId)
        .single();

      if (!existingBook) continue;

      const updates: Record<string, unknown> = {};

      // Fill missing description
      const cleanDesc = cleanDescription(result.description);
      if (cleanDesc && !existingBook.description) {
        updates.description = cleanDesc;
      }

      // Fill missing cover
      if (result.image && !existingBook.cover_url) {
        updates.cover_url = result.image;
      }

      // Fill missing page count
      if (result.numberOfPages && !existingBook.page_count) {
        updates.page_count = result.numberOfPages;
      }

      // Fill missing ISBN
      if (result.ISBN && !existingBook.isbn) {
        updates.isbn = result.ISBN;
      }

      // Fill missing series
      const series = parseSeriesPosition(result.Series);
      if (series && !existingBook.series_name) {
        updates.series_name = series.name;
        if (series.position) updates.series_position = series.position;
      }

      // Fill missing publisher
      if (result.publishedBy && !existingBook.publisher) {
        updates.publisher = result.publishedBy;
      }

      // Fill missing published year
      const year = parseYear(result.firstPublishedDate);
      if (year && !existingBook.published_year) {
        updates.published_year = year;
      }

      // Fill Goodreads ID/URL for Tier 2/3 books
      if (grBookId && !existingBook.goodreads_id) {
        updates.goodreads_id = grBookId;
        grIdsResolved++;
      }
      if (grUrl && !existingBook.goodreads_url) {
        updates.goodreads_url = grUrl;
      }

      // Extract Amazon ASIN from buyLinks
      if (result.buyLinks && !existingBook.amazon_asin) {
        const asin = extractAsin(result.buyLinks);
        if (asin) {
          updates.amazon_asin = asin;
          asinsFound++;
        }
      }

      // Update last_enriched_at
      if (Object.keys(updates).length > 0) {
        updates.last_enriched_at = new Date().toISOString();

        if (!DRY_RUN) {
          const { error } = await supabase
            .from("books")
            .update(updates)
            .eq("id", dbBookId);
          if (error) {
            console.warn(`  Update error for ${dbBookId}: ${error.message}`);
            errors++;
            continue;
          }
        }
        metadataUpdated++;
      }
    } catch (err) {
      console.warn(`  Error processing ${dbBookId}: ${err}`);
      errors++;
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Results processed: ${results.length}`);
  console.log(`Ratings upserted:  ${ratingsUpserted}`);
  console.log(`Metadata updated:  ${metadataUpdated}`);
  console.log(`GR IDs resolved:   ${grIdsResolved}`);
  console.log(`ASINs extracted:   ${asinsFound}`);
  console.log(`Skipped (no match): ${skipped}`);
  console.log(`Errors:            ${errors}`);

  if (DRY_RUN) {
    console.log("\n(Dry run — no changes written)");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
