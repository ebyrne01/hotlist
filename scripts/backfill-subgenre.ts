/**
 * Backfill subgenre for all canon books.
 *
 * Run with: npx tsx scripts/backfill-subgenre.ts
 * Requires: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
 *
 * Safe to run multiple times — idempotent updates.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { classifySubgenre } from "../lib/books/subgenre-classifier";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log("Fetching all canon books with genres...\n");

  let offset = 0;
  const batchSize = 500;
  let totalProcessed = 0;
  let totalClassified = 0;
  let totalSkipped = 0;
  const subgenreCounts: Record<string, number> = {};

  while (true) {
    const { data: books, error } = await supabase
      .from("books")
      .select("id, title, author, genres, subgenre")
      .eq("is_canon", true)
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error("Fetch error:", error.message);
      break;
    }

    if (!books || books.length === 0) break;

    const updates: { id: string; subgenre: string }[] = [];

    for (const book of books) {
      totalProcessed++;
      const genres = (book.genres as string[]) ?? [];

      if (genres.length === 0) {
        totalSkipped++;
        continue;
      }

      const subgenre = classifySubgenre(genres);

      if (subgenre) {
        totalClassified++;
        subgenreCounts[subgenre] = (subgenreCounts[subgenre] ?? 0) + 1;
        updates.push({ id: book.id as string, subgenre });
      } else {
        totalSkipped++;
      }
    }

    // Batch update
    for (const update of updates) {
      await supabase
        .from("books")
        .update({
          subgenre: update.subgenre,
          updated_at: new Date().toISOString(),
        })
        .eq("id", update.id);
    }

    console.log(
      `  Batch ${Math.floor(offset / batchSize) + 1}: ${books.length} books, ${updates.length} classified`
    );

    offset += batchSize;
    if (books.length < batchSize) break;
  }

  console.log("\n=== BACKFILL COMPLETE ===");
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Total classified: ${totalClassified}`);
  console.log(
    `Total skipped (no genres or no match): ${totalSkipped}`
  );
  console.log(
    `Coverage: ${((totalClassified / totalProcessed) * 100).toFixed(1)}%`
  );
  console.log("\nSubgenre distribution:");

  const sorted = Object.entries(subgenreCounts).sort(([, a], [, b]) => b - a);
  for (const [subgenre, count] of sorted) {
    const pct = ((count / totalClassified) * 100).toFixed(1);
    console.log(
      `  ${subgenre.padEnd(25)} ${String(count).padStart(5)}  (${pct}%)`
    );
  }
}

main().catch(console.error);
