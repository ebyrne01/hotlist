/**
 * One-time cleanup script: resolve books with placeholder "unknown-*" goodreads_id values.
 *
 * These rows were created before the Goodreads-canonical refactor and have
 * goodreads_id values like "unknown-E-kdBQAAQBAJ" (Google Books IDs).
 *
 * For each one we:
 *   1. Try to resolve the real Goodreads ID using title + author
 *   2. If found: update the row (goodreads_id, slug, metadata_source)
 *   3. If not found after both attempts in resolveToGoodreadsId: delete the row
 *
 * Usage: npx tsx scripts/cleanup-unknown-goodreads-ids.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local manually (no dotenv dependency)
const envPath = resolve(__dirname, "..", ".env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIndex = trimmed.indexOf("=");
  if (eqIndex === -1) continue;
  const key = trimmed.slice(0, eqIndex);
  const value = trimmed.slice(eqIndex + 1);
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

import { createClient } from "@supabase/supabase-js";
import { resolveToGoodreadsId, generateBookSlug } from "../lib/books/goodreads-search";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Rate limit: wait between Goodreads requests to be polite
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanup() {
  // 1. Fetch all books with unknown- goodreads IDs
  const { data: unknownBooks, error } = await supabase
    .from("books")
    .select("id, title, author, goodreads_id, google_books_id")
    .like("goodreads_id", "unknown-%")
    .order("title");

  if (error) {
    console.error("Failed to fetch unknown books:", error.message);
    process.exit(1);
  }

  if (!unknownBooks || unknownBooks.length === 0) {
    console.log("No books with unknown- goodreads IDs found. Nothing to do.");
    return;
  }

  console.log(`Found ${unknownBooks.length} books with unknown- goodreads IDs.\n`);

  let fixed = 0;
  let deleted = 0;
  let skippedDuplicate = 0;
  const errors: string[] = [];

  for (let i = 0; i < unknownBooks.length; i++) {
    const book = unknownBooks[i];
    const progress = `[${i + 1}/${unknownBooks.length}]`;

    console.log(`${progress} "${book.title}" by ${book.author}`);

    try {
      // resolveToGoodreadsId already makes two attempts (title+author, then title-only)
      const realGoodreadsId = await resolveToGoodreadsId(book.title, book.author);

      if (realGoodreadsId) {
        // Check if another row already has this goodreads_id (avoid unique constraint violation)
        const { data: existing } = await supabase
          .from("books")
          .select("id")
          .eq("goodreads_id", realGoodreadsId)
          .neq("id", book.id)
          .single();

        if (existing) {
          // A valid row already exists for this Goodreads ID — delete the duplicate
          console.log(`  -> Duplicate of existing book (goodreads_id: ${realGoodreadsId}). Deleting.`);

          // Clean up related data first
          await supabase.from("book_ratings").delete().eq("book_id", book.id);
          await supabase.from("book_spice").delete().eq("book_id", book.id);
          await supabase.from("book_tropes").delete().eq("book_id", book.id);
          await supabase.from("nyt_trending").delete().eq("book_id", book.id);

          await supabase.from("books").delete().eq("id", book.id);
          skippedDuplicate++;
          continue;
        }

        // Update with the real Goodreads ID
        const slug = generateBookSlug(book.title, realGoodreadsId);
        const { error: updateError } = await supabase
          .from("books")
          .update({
            goodreads_id: realGoodreadsId,
            slug,
            metadata_source: "goodreads",
          })
          .eq("id", book.id);

        if (updateError) {
          console.log(`  -> ERROR updating: ${updateError.message}`);
          errors.push(`${book.title}: ${updateError.message}`);
        } else {
          console.log(`  -> FIXED: goodreads_id = ${realGoodreadsId}`);
          fixed++;
        }
      } else {
        // Could not resolve — delete the row and its related data
        console.log(`  -> Could not resolve. Deleting.`);

        await supabase.from("book_ratings").delete().eq("book_id", book.id);
        await supabase.from("book_spice").delete().eq("book_id", book.id);
        await supabase.from("book_tropes").delete().eq("book_id", book.id);
        await supabase.from("nyt_trending").delete().eq("book_id", book.id);

        const { error: deleteError } = await supabase
          .from("books")
          .delete()
          .eq("id", book.id);

        if (deleteError) {
          console.log(`  -> ERROR deleting: ${deleteError.message}`);
          errors.push(`${book.title}: ${deleteError.message}`);
        } else {
          deleted++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  -> EXCEPTION: ${msg}`);
      errors.push(`${book.title}: ${msg}`);
    }

    // Small delay between books to avoid hammering Goodreads
    // (resolveToGoodreadsId already has internal delays, but this adds a buffer)
    await sleep(500);
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("CLEANUP SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total processed:    ${unknownBooks.length}`);
  console.log(`Fixed (resolved):   ${fixed}`);
  console.log(`Deleted (no match): ${deleted}`);
  console.log(`Deleted (duplicate):${skippedDuplicate}`);
  if (errors.length > 0) {
    console.log(`Errors:             ${errors.length}`);
    for (const e of errors) {
      console.log(`  - ${e}`);
    }
  }
  console.log("=".repeat(60));
}

cleanup().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
