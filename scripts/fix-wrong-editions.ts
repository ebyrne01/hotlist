/**
 * Fix wrong Goodreads editions — one-time cleanup script.
 *
 * Finds books in our DB whose stored Goodreads rating comes from an obscure
 * edition (low ratingCount), re-scrapes to find the canonical edition (highest
 * ratingCount), and updates both the rating and Goodreads ID.
 *
 * Usage:
 *   npx @dotenvx/dotenvx run -f .env.local -- npx tsx scripts/fix-wrong-editions.ts [--dry-run] [--limit 50]
 */

import { createClient } from "@supabase/supabase-js";
import { searchGoodreads } from "../lib/books/goodreads-search";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 100;

// Books with fewer than this many ratings are suspect
const SUSPECT_THRESHOLD = 500;
// Minimum improvement factor to justify switching editions
const MIN_IMPROVEMENT_FACTOR = 5;

interface SuspectBook {
  bookId: string;
  title: string;
  author: string;
  currentGoodreadsId: string | null;
  currentRating: number;
  currentRatingCount: number;
}

async function findSuspectBooks(): Promise<SuspectBook[]> {
  // Find books with low rating counts that are likely wrong editions
  const { data, error } = await supabase
    .from("book_ratings")
    .select("book_id, rating, rating_count")
    .eq("source", "goodreads")
    .lt("rating_count", SUSPECT_THRESHOLD)
    .gt("rating_count", 0)
    .order("rating_count", { ascending: true })
    .limit(limit);

  if (error || !data) {
    console.error("Failed to query book_ratings:", error);
    return [];
  }

  // Get book details for these
  const bookIds = data.map((r) => r.book_id);
  const { data: books } = await supabase
    .from("books")
    .select("id, title, author, goodreads_id")
    .in("id", bookIds);

  if (!books) return [];

  const bookMap = new Map(books.map((b) => [b.id, b]));

  return data
    .map((r) => {
      const book = bookMap.get(r.book_id);
      if (!book || !book.title || !book.author) return null;
      return {
        bookId: r.book_id,
        title: book.title,
        author: book.author,
        currentGoodreadsId: book.goodreads_id,
        currentRating: r.rating,
        currentRatingCount: r.rating_count,
      };
    })
    .filter((b): b is SuspectBook => b !== null);
}

async function fixBook(book: SuspectBook): Promise<boolean> {
  console.log(
    `\n📖 "${book.title}" by ${book.author}`
  );
  console.log(
    `   Current: GR#${book.currentGoodreadsId} — ${book.currentRating}⭐ (${book.currentRatingCount} ratings)`
  );

  // Search Goodreads for this book and find the canonical edition
  const results = await searchGoodreads(`${book.title} ${book.author}`);

  if (results.length === 0) {
    console.log("   ⚠️  No search results found, skipping");
    return false;
  }

  // Find the result with the highest rating count (canonical edition)
  let best = results[0];
  for (const r of results) {
    if ((r.ratingCount ?? 0) > (best.ratingCount ?? 0)) {
      best = r;
    }
  }

  const bestCount = best.ratingCount ?? 0;
  const bestRating = best.rating ?? 0;

  // Only fix if the canonical edition has significantly more ratings
  if (bestCount <= book.currentRatingCount * MIN_IMPROVEMENT_FACTOR) {
    console.log(
      `   ✅ Current edition looks fine (best found: ${bestCount} ratings, not ${MIN_IMPROVEMENT_FACTOR}x better)`
    );
    return false;
  }

  console.log(
    `   → Canonical: GR#${best.goodreadsId} — ${bestRating}⭐ (${bestCount.toLocaleString()} ratings)`
  );
  console.log(
    `   → Rating delta: ${(bestRating - book.currentRating).toFixed(2)}`
  );

  if (dryRun) {
    console.log("   🔍 DRY RUN — would update");
    return true;
  }

  // Update the rating
  const { error: ratingError } = await supabase
    .from("book_ratings")
    .upsert(
      {
        book_id: book.bookId,
        source: "goodreads",
        rating: bestRating,
        rating_count: bestCount,
        scraped_at: new Date().toISOString(),
      },
      { onConflict: "book_id,source" }
    );

  if (ratingError) {
    console.error("   ❌ Failed to update rating:", ratingError.message);
    return false;
  }

  // Update the Goodreads ID on the book if it changed
  if (best.goodreadsId !== book.currentGoodreadsId) {
    const { error: bookError } = await supabase
      .from("books")
      .update({
        goodreads_id: best.goodreadsId,
        goodreads_url: best.goodreadsUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", book.bookId);

    if (bookError) {
      console.error("   ❌ Failed to update Goodreads ID:", bookError.message);
      return false;
    }
    console.log(`   ✅ Updated GR ID: ${book.currentGoodreadsId} → ${best.goodreadsId}`);
  }

  console.log(
    `   ✅ Rating fixed: ${book.currentRating} → ${bestRating} (${bestCount.toLocaleString()} ratings)`
  );
  return true;
}

async function main() {
  console.log("=== Fix Wrong Goodreads Editions ===");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Suspect threshold: < ${SUSPECT_THRESHOLD} ratings`);
  console.log(`Limit: ${limit} books\n`);

  const suspects = await findSuspectBooks();
  console.log(`Found ${suspects.length} suspect books with < ${SUSPECT_THRESHOLD} ratings\n`);

  let fixed = 0;
  let skipped = 0;
  let errors = 0;

  for (const book of suspects) {
    try {
      const wasFixed = await fixBook(book);
      if (wasFixed) fixed++;
      else skipped++;
    } catch (err) {
      console.error(`   ❌ Error processing "${book.title}":`, err);
      errors++;
    }

    // Rate limit: 2 seconds between searches (respectful scraping)
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("\n=== Summary ===");
  console.log(`Total suspect: ${suspects.length}`);
  console.log(`Fixed: ${fixed}`);
  console.log(`Skipped (ok): ${skipped}`);
  console.log(`Errors: ${errors}`);

  if (dryRun && fixed > 0) {
    console.log(`\nRe-run without --dry-run to apply ${fixed} fixes.`);
  }
}

main().catch(console.error);
