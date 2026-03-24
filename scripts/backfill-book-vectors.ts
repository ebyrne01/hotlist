/**
 * Backfill book_trope_vectors from existing book_tropes data.
 *
 * For each book that has entries in book_tropes, builds a JSONB vector
 * with {trope_slug: 1.0} and upserts into book_trope_vectors.
 *
 * Usage: npx tsx scripts/backfill-book-vectors.ts [--dry-run]
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`Backfilling book_trope_vectors${dryRun ? " (DRY RUN)" : ""}...`);

  // Fetch all book_tropes with trope slugs
  const { data: btRows, error } = await supabase
    .from("book_tropes")
    .select("book_id, tropes(slug)");

  if (error) {
    console.error("Failed to fetch book_tropes:", error.message);
    process.exit(1);
  }

  if (!btRows || btRows.length === 0) {
    console.log("No book_tropes found.");
    return;
  }

  // Group by book_id
  const vectorMap = new Map<string, Record<string, number>>();
  for (const bt of btRows as Record<string, unknown>[]) {
    const bookId = bt.book_id as string;
    const tropeData = bt.tropes as { slug: string } | null;
    if (!tropeData) continue;

    const vector = vectorMap.get(bookId) ?? {};
    vector[tropeData.slug] = 1.0;
    vectorMap.set(bookId, vector);
  }

  console.log(`Found ${vectorMap.size} books with tropes.`);

  if (dryRun) {
    // Show a sample
    const sample = Array.from(vectorMap.entries()).slice(0, 3);
    for (const [bookId, vector] of sample) {
      console.log(`  ${bookId}: ${JSON.stringify(vector)}`);
    }
    console.log("Dry run complete — no changes made.");
    return;
  }

  // Upsert in batches of 100
  const entries = Array.from(vectorMap.entries());
  let upserted = 0;

  for (let i = 0; i < entries.length; i += 100) {
    const batch = entries.slice(i, i + 100).map(([bookId, vector]) => ({
      book_id: bookId,
      vector,
      updated_at: new Date().toISOString(),
    }));

    const { error: upsertError } = await supabase
      .from("book_trope_vectors")
      .upsert(batch, { onConflict: "book_id" });

    if (upsertError) {
      console.error(`Batch ${i / 100 + 1} failed:`, upsertError.message);
    } else {
      upserted += batch.length;
    }
  }

  console.log(`Done. Upserted ${upserted} book vectors.`);
}

main().catch(console.error);
