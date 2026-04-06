/**
 * One-time backfill: re-run subgenre classifier on canon books with no subgenre.
 *
 * Usage: npx tsx scripts/backfill-subgenres.ts [--dry-run]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { classifySubgenre } from "@/lib/books/subgenre-classifier";

const DRY_RUN = process.argv.includes("--dry-run");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log(`=== Subgenre Backfill${DRY_RUN ? " (DRY RUN)" : ""} ===\n`);

  const { data: books, error } = await supabase
    .from("books")
    .select("id, title, author, genres")
    .eq("is_canon", true)
    .is("subgenre", null);

  if (error) throw error;
  console.log(`Found ${books.length} canon books with no subgenre\n`);

  const results: Record<string, number> = {};
  let classified = 0;
  let unclassified = 0;

  for (const book of books) {
    const genres: string[] = book.genres ?? [];
    const subgenre = classifySubgenre(genres);

    if (subgenre) {
      results[subgenre] = (results[subgenre] ?? 0) + 1;
      classified++;

      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from("books")
          .update({ subgenre })
          .eq("id", book.id);
        if (updateError) {
          console.warn(`  Error updating ${book.title}: ${updateError.message}`);
        }
      }
    } else {
      unclassified++;
    }
  }

  console.log("=== RESULTS ===");
  console.log(`Classified: ${classified}`);
  for (const [subgenre, count] of Object.entries(results).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${subgenre}: ${count}`);
  }
  console.log(`Still unclassified: ${unclassified}`);

  if (DRY_RUN) {
    console.log("\n[dry-run] No changes made. Remove --dry-run to apply.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
