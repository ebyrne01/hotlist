/**
 * BACKFILL GENRE BUCKETING SPICE SIGNALS
 *
 * Scans all books with genre data and computes a genre_bucketing
 * spice signal for each, upserting into the spice_signals table.
 * Skips books that already have a genre_bucketing signal.
 *
 * Usage: npx tsx scripts/backfill-genre-spice.ts
 *        npx tsx scripts/backfill-genre-spice.ts --force   # overwrite existing
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { computeGenreBucketing } from "../lib/spice/genre-bucketing";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const BATCH_SIZE = 100;
const force = process.argv.includes("--force");

async function main() {
  const supabase = getAdminClient();

  // Get existing genre_bucketing signals so we can skip them
  const existingIds = new Set<string>();
  if (!force) {
    const { data: existing } = await supabase
      .from("spice_signals")
      .select("book_id")
      .eq("source", "genre_bucketing");
    if (existing) {
      for (const row of existing) {
        existingIds.add(row.book_id);
      }
    }
    console.log(`Found ${existingIds.size} books with existing genre_bucketing signals (skipping)`);
  }

  // Fetch all books with genres
  let offset = 0;
  let totalProcessed = 0;
  let totalUpserted = 0;
  let totalSkipped = 0;

  while (true) {
    const { data: books, error } = await supabase
      .from("books")
      .select("id, title, genres")
      .not("genres", "is", null)
      .order("created_at", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error("Error fetching books:", error.message);
      break;
    }

    if (!books || books.length === 0) break;

    for (const book of books) {
      totalProcessed++;
      const genres: string[] = book.genres ?? [];

      if (genres.length === 0) {
        totalSkipped++;
        continue;
      }

      if (!force && existingIds.has(book.id)) {
        totalSkipped++;
        continue;
      }

      const result = computeGenreBucketing(genres);
      if (!result) {
        totalSkipped++;
        continue;
      }

      const { error: upsertError } = await supabase.from("spice_signals").upsert(
        {
          book_id: book.id,
          source: "genre_bucketing",
          spice_value: result.spice,
          confidence: result.confidence,
          evidence: {
            matched_tags: result.matchedTags,
            total_genres: genres.length,
            computed_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "book_id,source" }
      );

      if (upsertError) {
        console.error(`Error upserting for "${book.title}":`, upsertError.message);
      } else {
        totalUpserted++;
        if (totalUpserted % 50 === 0) {
          console.log(`  ... upserted ${totalUpserted} so far`);
        }
      }
    }

    offset += books.length;
    if (books.length < BATCH_SIZE) break;
  }

  console.log(`\nDone!`);
  console.log(`  Books scanned: ${totalProcessed}`);
  console.log(`  Signals upserted: ${totalUpserted}`);
  console.log(`  Skipped: ${totalSkipped}`);

  // Spot-check some results
  console.log(`\nSpot-checking results...`);
  const { data: checks } = await supabase
    .from("spice_signals")
    .select("book_id, spice_value, confidence, evidence")
    .eq("source", "genre_bucketing")
    .order("updated_at", { ascending: false })
    .limit(5);

  if (checks) {
    for (const row of checks) {
      const evidence = row.evidence as Record<string, unknown>;
      console.log(
        `  book=${row.book_id.slice(0, 8)}... spice=${row.spice_value} confidence=${row.confidence} tags=${(evidence?.matched_tags as string[])?.join(", ")}`
      );
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
