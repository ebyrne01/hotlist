/**
 * Backfill romance.io data (spice, rating, tags/tropes) for all catalog books.
 *
 * Uses the upgraded getRomanceIoSpice() which now queries with the "tagged"
 * format, returning spice + rating + raw tags in one Serper call.
 *
 * Runs in batches of 10 with 600ms delays between Serper calls.
 * Automatically resumes from where it left off (skips books that already
 * have a romance_io_slug set).
 *
 * Usage:
 *   npx tsx scripts/romance-io-test/backfill-romance-io.ts
 *   npx tsx scripts/romance-io-test/backfill-romance-io.ts --all     # re-process even books with existing data
 *   npx tsx scripts/romance-io-test/backfill-romance-io.ts --known   # only books already known to be on romance.io (have slug)
 *   npx tsx scripts/romance-io-test/backfill-romance-io.ts --test    # process 20 books only
 *   npx tsx scripts/romance-io-test/backfill-romance-io.ts --offset 500  # start from book #500
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { getRomanceIoSpice } from "../../lib/scraping/romance-io-search";
import { classifyRomanceIoTags } from "../../lib/scraping/romance-io-tags";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const args = process.argv.slice(2);
const isTest = args.includes("--test");
const processAll = args.includes("--all");
const knownOnly = args.includes("--known");
const offsetIdx = args.indexOf("--offset");
const startOffset = offsetIdx >= 0 ? parseInt(args[offsetIdx + 1]) : 0;

interface BookRow {
  id: string;
  title: string;
  author: string;
  romance_io_slug: string | null;
}

async function main() {
  console.log("=== Romance.io Backfill ===\n");

  // Fetch all books
  const batchSize = 1000;
  const allBooks: BookRow[] = [];
  let offset = 0;
  while (true) {
    const query = supabase
      .from("books")
      .select("id, title, author, romance_io_slug")
      .order("created_at", { ascending: false })
      .range(offset, offset + batchSize - 1);

    const { data, error } = await query;
    if (error) {
      console.error("Failed to fetch books:", error);
      return;
    }
    if (!data || data.length === 0) break;
    allBooks.push(...(data as BookRow[]));
    if (data.length < batchSize) break;
    offset += batchSize;
  }

  console.log(`Total books in catalog: ${allBooks.length}`);

  // Filter to books that need processing
  let booksToProcess: BookRow[];
  let modeLabel: string;
  if (knownOnly) {
    booksToProcess = allBooks.filter((b) => !!b.romance_io_slug);
    modeLabel = "known romance.io matches only";
  } else if (processAll) {
    booksToProcess = allBooks;
    modeLabel = "all";
  } else {
    booksToProcess = allBooks.filter((b) => !b.romance_io_slug);
    modeLabel = "missing romance_io_slug";
  }

  console.log(`Books to process: ${booksToProcess.length} (${modeLabel})`);

  const limit = isTest ? 20 : booksToProcess.length;
  const books = booksToProcess.slice(startOffset, startOffset + limit);
  console.log(`Processing ${books.length} books (offset ${startOffset})${isTest ? " [TEST MODE]" : ""}\n`);

  // Load canonical tropes for mapping
  const { data: tropeRows } = await supabase.from("tropes").select("id, slug");
  const tropeSlugToId = new Map<string, string>();
  for (const t of tropeRows ?? []) {
    tropeSlugToId.set(t.slug, t.id);
  }
  console.log(`Loaded ${tropeSlugToId.size} canonical tropes\n`);

  // Stats
  let processed = 0;
  let hits = 0;
  let spiceHits = 0;
  let tagHits = 0;
  let tropeInserts = 0;
  let ratingHits = 0;
  const allRawTags: string[] = [];
  const uncategorizedCounts = new Map<string, number>();
  const errors: string[] = [];

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    processed++;

    if (processed % 50 === 0) {
      console.log(`\n--- Progress: ${processed}/${books.length} (${hits} hits, ${tagHits} with tags) ---\n`);
    }

    try {
      const result = await getRomanceIoSpice(book.title, book.author);

      if (!result || result.confidence === "low") {
        continue;
      }

      hits++;

      // For --known mode, skip spice/rating/slug storage (already have good data)
      // Only store new tag/trope data
      const hasExistingData = !!book.romance_io_slug;

      if (!hasExistingData) {
        // Store spice
        if (result.spiceLevel) {
          spiceHits++;
          const signalConfidence = result.confidence === "high" ? 0.85 : 0.7;

          await supabase.from("book_spice").upsert(
            {
              book_id: book.id,
              source: "romance_io",
              spice_level: result.spiceLevel,
              confidence: result.confidence,
              scraped_at: new Date().toISOString(),
            },
            { onConflict: "book_id,source" }
          );

          await supabase.from("spice_signals").upsert(
            {
              book_id: book.id,
              source: "romance_io",
              spice_value: result.spiceLevel,
              confidence: signalConfidence,
              evidence: {
                heat_label: result.heatLabel,
                match_confidence: result.confidence,
                scraped_at: new Date().toISOString(),
              },
              updated_at: new Date().toISOString(),
            },
            { onConflict: "book_id,source" }
          );
        }

        // Store rating
        if (result.romanceIoRating && result.romanceIoRating > 0) {
          ratingHits++;
          await supabase.from("book_ratings").upsert(
            {
              book_id: book.id,
              source: "romance_io",
              rating: result.romanceIoRating,
              rating_count: null,
              scraped_at: new Date().toISOString(),
            },
            { onConflict: "book_id,source" }
          );
        }

        // Store slug + heat label on book
        await supabase.from("books").update({
          romance_io_slug: result.romanceIoSlug,
          romance_io_heat_label: result.heatLabel,
        }).eq("id", book.id);
      }

      // Process tags → tropes
      if (result.rawTags && result.rawTags.length > 0) {
        tagHits++;
        allRawTags.push(...result.rawTags);

        const classified = classifyRomanceIoTags(result.rawTags);

        // Track uncategorized tags
        for (const tag of classified.uncategorized) {
          uncategorizedCounts.set(tag, (uncategorizedCounts.get(tag) || 0) + 1);
        }

        // Insert canonical tropes
        if (classified.tropes.length > 0) {
          const inserts = classified.tropes
            .filter((t) => tropeSlugToId.has(t.canonicalSlug))
            .map((t) => ({
              book_id: book.id,
              trope_id: tropeSlugToId.get(t.canonicalSlug)!,
              source: "romance_io",
            }));

          if (inserts.length > 0) {
            await supabase
              .from("book_tropes")
              .upsert(inserts, { onConflict: "book_id,trope_id" });
            tropeInserts += inserts.length;
          }
        }
      }
    } catch (err) {
      const msg = `Error processing "${book.title}": ${err}`;
      console.error(msg);
      errors.push(msg);
    }

    // Rate limit: 600ms between Serper calls
    await new Promise((r) => setTimeout(r, 600));
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("BACKFILL SUMMARY");
  console.log("=".repeat(60));
  console.log(`Books processed: ${processed}`);
  console.log(`Hits (found on romance.io): ${hits} (${((hits / processed) * 100).toFixed(1)}%)`);
  console.log(`  With spice data: ${spiceHits}`);
  console.log(`  With rating: ${ratingHits}`);
  console.log(`  With tags: ${tagHits}`);
  console.log(`Trope inserts: ${tropeInserts}`);
  console.log(`Errors: ${errors.length}`);

  // Tag distribution
  if (allRawTags.length > 0) {
    const tagCounts = new Map<string, number>();
    for (const tag of allRawTags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
    const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);

    console.log(`\nTop 30 raw tags:`);
    for (const [tag, count] of sorted.slice(0, 30)) {
      console.log(`  ${tag}: ${count}`);
    }
  }

  if (uncategorizedCounts.size > 0) {
    const sorted = [...uncategorizedCounts.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`\nUncategorized tags (${uncategorizedCounts.size} unique):`);
    for (const [tag, count] of sorted.slice(0, 30)) {
      console.log(`  ${tag}: ${count}`);
    }
  }

  // Estimated cost
  const queriesUsed = hits > 0 ? processed : processed; // 1 query per book (sometimes 2 with fallback)
  console.log(`\nEstimated Serper queries used: ~${queriesUsed}`);
  console.log(`Estimated cost: ~$${(queriesUsed * 0.001).toFixed(2)}`);
}

main().catch(console.error);
