/**
 * One-time DB cleanup: merge duplicate books and delete junk.
 *
 * Finds books with the same normalized title+author but different rows,
 * merges enrichment data onto the best row, and deletes the inferior row.
 * Also deletes books that fail isJunkTitle checks.
 *
 * Usage: npx tsx scripts/merge-duplicate-books.ts
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// Junk title patterns (mirrored from romance-filter.ts)
const JUNK_TITLE_PATTERNS =
  /\b(box\s*set|boxed set|collection set|bundle|omnibus|books?\s+\d+-\d+|\d+-book|complete\s+series|the\s+complete|books?\s+\d+\s*[-–&]\s*\d+|volumes?\s+\d+\s*[-–]\s*\d+|study guide|summary of|trivia|journal|workbook|coloring book|conversation starters|supersummary|bookhabits|untitled|cliff\s*notes|hardcover box|paperback box|omnibus edition|deluxe\s+limited\s+edition|special\s+edition|collector'?s?\s+edition|anniversary\s+edition|illustrated\s+edition|how well do you know|quiz|test your knowledge|unofficial guide|companion guide|discussion questions|reading guide|reader.?s guide|book club questions|essay|analysis of|literary analysis|critical analysis|study companion|bi-centenary|centenary|proceedings|symposium|conference|dissertation|thesis|municipal|township|genealogy|census)\b/i;

const FOREIGN_EDITION_PATTERN =
  /\(\s*(spanish|french|german|italian|portuguese|dutch|swedish|norwegian|danish|finnish|polish|czech|hungarian|romanian|turkish|arabic|chinese|japanese|korean|russian|hindi|bengali|urdu|thai|vietnamese|indonesian|malay|tagalog|catalan|galician|basque)\s+edition\s*\)/i;

const MULTI_TITLE_PATTERN = /\s+\/\s+.+\s+\/\s+/;

function isJunkTitle(title: string): boolean {
  return JUNK_TITLE_PATTERNS.test(title) || FOREIGN_EDITION_PATTERN.test(title) || MULTI_TITLE_PATTERN.test(title);
}

function normalizeForGrouping(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface BookRow {
  id: string;
  title: string;
  author: string;
  goodreads_id: string;
  cover_url: string | null;
  ai_synopsis: string | null;
  description: string | null;
  isbn: string | null;
  isbn13: string | null;
  amazon_asin: string | null;
  romance_io_slug: string | null;
  romance_io_heat_label: string | null;
}

function scoreBook(book: BookRow, ratingCount: number): number {
  let score = 0;
  if (book.cover_url) score += 1;
  if (book.ai_synopsis) score += 1;
  if (book.description && book.description.length > 20) score += 1;
  if (book.isbn || book.isbn13) score += 1;
  if (book.amazon_asin) score += 1;
  if (book.romance_io_slug) score += 1;
  if (book.romance_io_heat_label) score += 1;
  score += ratingCount; // more ratings = better edition
  return score;
}

async function main() {
  console.log("[merge] Starting duplicate book merge...\n");

  // ── Step 1: Fetch ALL books (paginate past Supabase 1000-row default limit) ──
  const allBooks: BookRow[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("books")
      .select("id, title, author, goodreads_id, cover_url, ai_synopsis, description, isbn, isbn13, amazon_asin, romance_io_slug, romance_io_heat_label")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("[merge] Failed to fetch books:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allBooks.push(...(data as BookRow[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(`[merge] Loaded ${allBooks.length} books from database (${Math.ceil(allBooks.length / PAGE_SIZE)} pages)`);

  // Delete junk titles
  const junkBooks = allBooks.filter((b) => isJunkTitle(b.title));
  if (junkBooks.length > 0) {
    console.log(`\n[merge] Found ${junkBooks.length} junk titles to delete:`);
    for (const junk of junkBooks) {
      console.log(`  - "${junk.title}" (${junk.id})`);
      const { error } = await supabase.from("books").delete().eq("id", junk.id);
      if (error) {
        console.error(`  [merge] Failed to delete: ${error.message}`);
      }
    }
    console.log(`[merge] Deleted ${junkBooks.length} junk titles\n`);
  }

  // ── Step 2: Group by normalized title+author ──
  const nonJunkBooks = allBooks.filter((b) => !isJunkTitle(b.title));
  const groups = new Map<string, BookRow[]>();

  for (const book of nonJunkBooks) {
    const key = `${normalizeForGrouping(book.title)}::${normalizeForGrouping(book.author)}`;
    const group = groups.get(key) ?? [];
    group.push(book as BookRow);
    groups.set(key, group);
  }

  const duplicateGroups = Array.from(groups.entries()).filter(([, books]) => books.length > 1);
  console.log(`[merge] Found ${duplicateGroups.length} groups with duplicates\n`);

  if (duplicateGroups.length === 0) {
    console.log("[merge] No duplicates found. Database is clean!");
    return;
  }

  // ── Step 3: Merge each duplicate group ──
  for (const [key, books] of duplicateGroups) {
    console.log(`[merge] Processing: "${books[0].title}" by ${books[0].author} (${books.length} copies)`);

    // Get rating counts for each book
    const ratingCounts = await Promise.all(
      books.map(async (b) => {
        const { count } = await supabase
          .from("book_ratings")
          .select("*", { count: "exact", head: true })
          .eq("book_id", b.id);
        return count ?? 0;
      })
    );

    // Score each book and pick the winner
    const scored = books.map((b, i) => ({ book: b, score: scoreBook(b, ratingCounts[i]) }));
    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0].book;
    const losers = scored.slice(1).map((s) => s.book);

    console.log(`  Winner: ${winner.goodreads_id} (score: ${scored[0].score})`);

    for (const loser of losers) {
      console.log(`  Merging loser: ${loser.goodreads_id} into winner...`);

      // Move book_ratings (ignore conflicts — winner's ratings take precedence)
      const { data: loserRatings } = await supabase
        .from("book_ratings")
        .select("*")
        .eq("book_id", loser.id);

      for (const rating of loserRatings ?? []) {
        const { data: existing } = await supabase
          .from("book_ratings")
          .select("id")
          .eq("book_id", winner.id)
          .eq("source", rating.source)
          .single();

        if (!existing) {
          await supabase
            .from("book_ratings")
            .update({ book_id: winner.id })
            .eq("id", rating.id);
        }
      }

      // Move book_spice (ignore conflicts)
      const { data: loserSpice } = await supabase
        .from("book_spice")
        .select("*")
        .eq("book_id", loser.id);

      for (const spice of loserSpice ?? []) {
        const { data: existing } = await supabase
          .from("book_spice")
          .select("id")
          .eq("book_id", winner.id)
          .eq("source", spice.source)
          .single();

        if (!existing) {
          await supabase
            .from("book_spice")
            .update({ book_id: winner.id })
            .eq("id", spice.id);
        }
      }

      // Move book_tropes (ignore conflicts)
      const { data: loserTropes } = await supabase
        .from("book_tropes")
        .select("*")
        .eq("book_id", loser.id);

      for (const trope of loserTropes ?? []) {
        const { data: existing } = await supabase
          .from("book_tropes")
          .select("id")
          .eq("book_id", winner.id)
          .eq("trope_id", trope.trope_id)
          .single();

        if (!existing) {
          await supabase
            .from("book_tropes")
            .update({ book_id: winner.id })
            .eq("id", trope.id);
        }
      }

      // Move hotlist_books (handle conflicts — keep winner's)
      const { data: loserHotlistBooks } = await supabase
        .from("hotlist_books")
        .select("*")
        .eq("book_id", loser.id);

      for (const hb of loserHotlistBooks ?? []) {
        const { data: existing } = await supabase
          .from("hotlist_books")
          .select("id")
          .eq("hotlist_id", hb.hotlist_id)
          .eq("book_id", winner.id)
          .single();

        if (!existing) {
          await supabase
            .from("hotlist_books")
            .update({ book_id: winner.id })
            .eq("id", hb.id);
        } else {
          // Delete the loser's hotlist_books entry
          await supabase.from("hotlist_books").delete().eq("id", hb.id);
        }
      }

      // Move reading_status (keep winner's if conflict)
      const { data: loserStatus } = await supabase
        .from("reading_status")
        .select("*")
        .eq("book_id", loser.id);

      for (const status of loserStatus ?? []) {
        const { data: existing } = await supabase
          .from("reading_status")
          .select("id")
          .eq("book_id", winner.id)
          .eq("user_id", status.user_id)
          .single();

        if (!existing) {
          await supabase
            .from("reading_status")
            .update({ book_id: winner.id })
            .eq("id", status.id);
        } else {
          await supabase.from("reading_status").delete().eq("id", status.id);
        }
      }

      // Move user_ratings (keep winner's if conflict)
      const { data: loserUserRatings } = await supabase
        .from("user_ratings")
        .select("*")
        .eq("book_id", loser.id);

      for (const ur of loserUserRatings ?? []) {
        const { data: existing } = await supabase
          .from("user_ratings")
          .select("id")
          .eq("book_id", winner.id)
          .eq("user_id", ur.user_id)
          .single();

        if (!existing) {
          await supabase
            .from("user_ratings")
            .update({ book_id: winner.id })
            .eq("id", ur.id);
        } else {
          await supabase.from("user_ratings").delete().eq("id", ur.id);
        }
      }

      // Delete the loser row (remaining child rows cleaned up by CASCADE)
      const { error: deleteError } = await supabase
        .from("books")
        .delete()
        .eq("id", loser.id);

      if (deleteError) {
        console.error(`  [merge] Failed to delete loser ${loser.id}: ${deleteError.message}`);
      } else {
        console.log(`  [merge] Merged "${books[0].title}" — kept ${winner.id}, deleted ${loser.id}`);
      }
    }
  }

  console.log("\n[merge] Done! Run your search to verify.");
}

main().catch((err) => {
  console.error("[merge] Fatal error:", err);
  process.exit(1);
});
