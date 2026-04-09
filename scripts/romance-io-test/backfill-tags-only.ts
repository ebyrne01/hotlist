/**
 * Re-query romance.io for TAGS ONLY on books that got a hit but no tags.
 *
 * These are the ~1,716 books with a romance_io_slug (confirmed match)
 * but no rows in book_tropes from romance_io. The first backfill used
 * a query format that didn't anchor on the tag section of the page.
 *
 * This script uses the updated query format:
 *   site:romance.io "{title}" "tagged as"
 *
 * It does NOT re-store spice/rating/slug — only extracts and stores tags/tropes.
 *
 * Usage:
 *   npx tsx scripts/romance-io-test/backfill-tags-only.ts
 *   npx tsx scripts/romance-io-test/backfill-tags-only.ts --test     # 20 books only
 *   npx tsx scripts/romance-io-test/backfill-tags-only.ts --offset 500
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { extractTagsFromSnippet } from "../../lib/scraping/romance-io-tags";
import { classifyRomanceIoTags } from "../../lib/scraping/romance-io-tags";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const SERPER_ENDPOINT = "https://google.serper.dev/search";
const SERPER_API_KEY = process.env.SERPER_API_KEY!;

const args = process.argv.slice(2);
const isTest = args.includes("--test");
const offsetIdx = args.indexOf("--offset");
const startOffset = offsetIdx >= 0 ? parseInt(args[offsetIdx + 1]) : 0;

interface BookRow {
  id: string;
  title: string;
  author: string;
  romance_io_slug: string;
}

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  rating?: number;
  ratingCount?: number;
}

async function main() {
  console.log("=== Romance.io Tags-Only Backfill ===\n");

  if (!SERPER_API_KEY) {
    console.error("SERPER_API_KEY not set");
    process.exit(1);
  }

  // Fetch books that have a romance_io_slug but NO romance_io tropes
  const batchSize = 1000;
  const allBooks: BookRow[] = [];
  let offset = 0;

  while (true) {
    // Get books with slug
    const { data, error } = await supabase
      .from("books")
      .select("id, title, author, romance_io_slug")
      .not("romance_io_slug", "is", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error("Failed to fetch books:", error);
      return;
    }
    if (!data || data.length === 0) break;
    allBooks.push(...(data as BookRow[]));
    if (data.length < batchSize) break;
    offset += batchSize;
  }

  // Filter out books that already have romance_io tropes
  const { data: booksWithTropes } = await supabase
    .from("book_tropes")
    .select("book_id")
    .eq("source", "romance_io");

  const hasTagsSet = new Set((booksWithTropes ?? []).map((r) => r.book_id));
  const booksNeedingTags = allBooks.filter((b) => !hasTagsSet.has(b.id));

  console.log(`Total books with romance_io_slug: ${allBooks.length}`);
  console.log(`Already have tags: ${hasTagsSet.size}`);
  console.log(`Need tags: ${booksNeedingTags.length}`);

  const limit = isTest ? 20 : booksNeedingTags.length;
  const books = booksNeedingTags.slice(startOffset, startOffset + limit);
  console.log(
    `Processing ${books.length} books (offset ${startOffset})${isTest ? " [TEST MODE]" : ""}\n`
  );

  // Load canonical tropes for mapping
  const { data: tropeRows } = await supabase.from("tropes").select("id, slug");
  const tropeSlugToId = new Map<string, string>();
  for (const t of tropeRows ?? []) {
    tropeSlugToId.set(t.slug, t.id);
  }
  console.log(`Loaded ${tropeSlugToId.size} canonical tropes\n`);

  // Stats
  let processed = 0;
  let queriesMade = 0;
  let snippetHits = 0;
  let tagHits = 0;
  let tropeInserts = 0;
  const allRawTags: string[] = [];
  const uncategorizedCounts = new Map<string, number>();
  const errors: string[] = [];

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    processed++;

    if (processed % 50 === 0) {
      console.log(
        `\n--- Progress: ${processed}/${books.length} | queries: ${queriesMade} | tag hits: ${tagHits} | trope inserts: ${tropeInserts} ---\n`
      );
    }

    try {
      // New query format: "tagged as" anchors on the tag section
      const query = `site:romance.io "${book.title}" "tagged as"`;
      queriesMade++;

      const response = await fetch(SERPER_ENDPOINT, {
        method: "POST",
        headers: {
          "X-API-KEY": SERPER_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, num: 5 }),
      });

      if (!response.ok) {
        errors.push(`Serper error ${response.status} for "${book.title}"`);
        continue;
      }

      const data = await response.json();
      const results: SerperResult[] = (data.organic ?? []).filter(
        (r: SerperResult) => r.link.includes("romance.io/")
      );

      if (results.length === 0) continue;
      snippetHits++;

      // Extract tags from ALL romance.io snippets
      const allTags: string[] = [];
      for (const result of results) {
        const snippetTags = extractTagsFromSnippet(result.snippet);
        for (const tag of snippetTags) {
          if (!allTags.includes(tag)) allTags.push(tag);
        }
      }

      if (allTags.length === 0) continue;
      tagHits++;
      allRawTags.push(...allTags);

      // Classify tags
      const classified = classifyRomanceIoTags(allTags);

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
          const { error: upsertError } = await supabase
            .from("book_tropes")
            .upsert(inserts, { onConflict: "book_id,trope_id" });

          if (upsertError) {
            errors.push(`Upsert error for "${book.title}": ${upsertError.message}`);
          } else {
            tropeInserts += inserts.length;
          }
        }
      }

      if (i < 5 || tagHits <= 5) {
        console.log(
          `  "${book.title}" → ${allTags.length} tags, ${classified.tropes.length} tropes [${allTags.slice(0, 5).join(", ")}${allTags.length > 5 ? "..." : ""}]`
        );
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
  console.log("TAGS-ONLY BACKFILL SUMMARY");
  console.log("=".repeat(60));
  console.log(`Books processed: ${processed}`);
  console.log(`Serper queries used: ${queriesMade}`);
  console.log(`Got romance.io snippets: ${snippetHits} (${((snippetHits / processed) * 100).toFixed(1)}%)`);
  console.log(`Got tags from snippets: ${tagHits} (${((tagHits / processed) * 100).toFixed(1)}% of processed, ${snippetHits > 0 ? ((tagHits / snippetHits) * 100).toFixed(1) : 0}% of snippet hits)`);
  console.log(`Trope inserts: ${tropeInserts}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Estimated cost: ~$${(queriesMade * 0.001).toFixed(2)}`);

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
}

main().catch(console.error);
