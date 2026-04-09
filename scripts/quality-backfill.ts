/**
 * QUALITY BACKFILL SCRIPT
 *
 * One-time script that runs the rules engine against every existing book.
 *
 * Usage:
 *   npx tsx scripts/quality-backfill.ts          # Normal speed (1200ms delay, Haiku-safe)
 *   npx tsx scripts/quality-backfill.ts --fast    # Fast mode (50ms delay, rules-only)
 */

import { createClient } from "@supabase/supabase-js";

// ── Inline the rules engine logic to avoid Next.js import issues ──
// We duplicate the minimal types and import path resolution here
// because tsx scripts can't resolve @/ aliases reliably.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Types ─────────────────────────────────────────────

interface BookRow {
  id: string;
  title: string;
  author: string;
  series_name: string | null;
  series_position: string | null;
  ai_synopsis: string | null;
  page_count: number | null;
  published_year: number | null;
}

interface FlagInsert {
  book_id: string;
  field_name: string;
  issue_type: string;
  source: string;
  priority: string;
  rule_id: string;
  confidence: number;
  original_value: string | null;
  suggested_value: string | null;
  auto_fixable: boolean;
}

// ── Rules (mirrored from rules-engine.ts) ─────────────

const SERIES_EDITION_EXACT = new Set([
  "kindle edition", "large print", "large print edition", "unabridged",
  "abridged", "audio cd", "audiobook", "hardcover", "paperback",
  "mass market paperback", "board book",
]);

const SERIES_EDITION_SUBSTRINGS = [
  "large print", "kindle edition", "special edition",
  "collector's edition", "anniversary edition", "illustrated edition",
];

const PUBLISHER_COLLECTION_REGEX_1 =
  /^(romance|love|passion|heat|fire|desire|harlequin|avon|mills\s*&?\s*boon)\s+(collection|series|bundle|library|anthology|presents|modern|blaze|desire|intrigue)\s*(vol\.?\s*\d+)?$/i;

const PUBLISHER_COLLECTION_REGEX_2 =
  /^\d+[\s-]?(book|novel|story)\s+(collection|bundle|series|set)$/i;

const PUBLISHER_COLLECTION_EXACT = new Set([
  "complete series", "box set", "complete collection", "the complete series",
]);

const TITLE_EDITION_REGEX =
  /\s*[\(\[](large print(?:\s+edition)?|kindle edition|unabridged|abridged|a novel|a romance|a novella|special edition|anniversary edition|illustrated edition)[\)\]]/i;

const TITLE_BY_AUTHOR_REGEX = /^by\s+\w+\s+\w+\s*[-–—:]/i;

const SYNOPSIS_PLACEHOLDERS = [
  "synopsis not available", "no synopsis", "coming soon", "tbd",
  "n/a", "not available", "no description available", "description unavailable",
];

function checkBook(book: BookRow): FlagInsert[] {
  const flags: FlagInsert[] = [];

  // series_edition_artifact
  if (book.series_name) {
    const trimmed = book.series_name.trim();
    const lower = trimmed.toLowerCase();
    if (SERIES_EDITION_EXACT.has(lower) || SERIES_EDITION_SUBSTRINGS.some(s => lower.includes(s))) {
      flags.push({
        book_id: book.id, field_name: "series_name", issue_type: "edition_artifact",
        source: "rules_engine", priority: "P1", rule_id: "series_edition_artifact",
        confidence: 1.0, original_value: trimmed, suggested_value: null, auto_fixable: true,
      });
    }

    // series_publisher_collection
    if (!flags.some(f => f.field_name === "series_name") &&
        (PUBLISHER_COLLECTION_EXACT.has(lower) ||
         PUBLISHER_COLLECTION_REGEX_1.test(trimmed) ||
         PUBLISHER_COLLECTION_REGEX_2.test(trimmed))) {
      flags.push({
        book_id: book.id, field_name: "series_name", issue_type: "publisher_collection",
        source: "rules_engine", priority: "P2", rule_id: "series_publisher_collection",
        confidence: 0.85, original_value: trimmed, suggested_value: null, auto_fixable: true,
      });
    }

    // series_numeric_only
    if (!flags.some(f => f.field_name === "series_name") &&
        (/^\d+$/.test(trimmed) || /^book\s+\d+\s+of\s+\d+$/i.test(trimmed) || /^stand-?alone$/i.test(trimmed))) {
      flags.push({
        book_id: book.id, field_name: "series_name", issue_type: "numeric_only_series",
        source: "rules_engine", priority: "P2", rule_id: "series_numeric_only",
        confidence: 1.0, original_value: trimmed, suggested_value: null, auto_fixable: true,
      });
    }
  }

  // title_edition_artifact
  const titleMatch = book.title.match(TITLE_EDITION_REGEX);
  if (titleMatch) {
    const cleaned = book.title.replace(TITLE_EDITION_REGEX, "").trim();
    flags.push({
      book_id: book.id, field_name: "title", issue_type: "edition_in_title",
      source: "rules_engine", priority: "P0", rule_id: "title_edition_artifact",
      confidence: 0.95, original_value: book.title, suggested_value: cleaned || null, auto_fixable: true,
    });
  }

  // title_by_author_artifact
  if (TITLE_BY_AUTHOR_REGEX.test(book.title)) {
    flags.push({
      book_id: book.id, field_name: "title", issue_type: "by_author_in_title",
      source: "rules_engine", priority: "P0", rule_id: "title_by_author_artifact",
      confidence: 0.90, original_value: book.title, suggested_value: null, auto_fixable: false,
    });
  }

  // synopsis_too_short
  if (book.ai_synopsis) {
    const trimmed = book.ai_synopsis.trim();
    const lower = trimmed.toLowerCase();
    if (trimmed.length < 60 || SYNOPSIS_PLACEHOLDERS.some(p => lower === p || lower.startsWith(p))) {
      flags.push({
        book_id: book.id, field_name: "ai_synopsis", issue_type: "synopsis_too_short",
        source: "rules_engine", priority: "P2", rule_id: "synopsis_too_short",
        confidence: 1.0, original_value: trimmed, suggested_value: null, auto_fixable: false,
      });
    }
  }

  // implausible_page_count
  if (book.page_count != null && (book.page_count < 10 || book.page_count > 5000)) {
    flags.push({
      book_id: book.id, field_name: "page_count", issue_type: "implausible_page_count",
      source: "rules_engine", priority: "P1", rule_id: "implausible_page_count",
      confidence: 1.0, original_value: String(book.page_count), suggested_value: null, auto_fixable: true,
    });
  }

  // future_publish_year
  const currentYear = new Date().getFullYear();
  if (book.published_year != null && book.published_year > currentYear + 2) {
    flags.push({
      book_id: book.id, field_name: "published_year", issue_type: "future_publish_year",
      source: "rules_engine", priority: "P1", rule_id: "future_publish_year",
      confidence: 1.0, original_value: String(book.published_year), suggested_value: null, auto_fixable: true,
    });
  }

  return flags;
}

// ── Main ──────────────────────────────────────────────

async function main() {
  const isFast = process.argv.includes("--fast");
  const delay = isFast ? 50 : 1200; // 50ms for rules-only, 1200ms for Haiku-safe
  console.log(`[backfill] Starting quality backfill (${isFast ? "fast" : "normal"} mode, ${delay}ms delay)`);

  const batchSize = 500;
  let offset = 0;
  let totalChecked = 0;
  let totalFlagged = 0;
  const issueBreakdown: Record<string, number> = {};

  while (true) {
    const { data: books, error } = await supabase
      .from("books")
      .select("id, title, author, series_name, series_position, ai_synopsis, page_count, published_year")
      .order("created_at", { ascending: false })
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error("[backfill] Query error:", error.message);
      break;
    }

    if (!books || books.length === 0) break;

    for (const book of books as BookRow[]) {
      const flags = checkBook(book);

      for (const flag of flags) {
        const { error: insertError } = await supabase
          .from("quality_flags")
          .insert(flag);

        // 23505 = unique_violation — skip
        if (insertError && insertError.code !== "23505") {
          console.warn(`[backfill] Insert error for "${book.title}":`, insertError.message);
        } else if (!insertError) {
          totalFlagged++;
          issueBreakdown[flag.issue_type] = (issueBreakdown[flag.issue_type] || 0) + 1;
        }
      }

      totalChecked++;

      if (totalChecked % 100 === 0) {
        console.log(`[backfill] ${totalChecked} checked, ${totalFlagged} flags created`);
      }

      // Throttle
      await new Promise((r) => setTimeout(r, delay));
    }

    if (books.length < batchSize) break;
    offset += batchSize;
  }

  console.log("\n[backfill] Complete!");
  console.log(`  Books checked: ${totalChecked}`);
  console.log(`  Flags created: ${totalFlagged}`);
  console.log("  Breakdown:");
  for (const [type, count] of Object.entries(issueBreakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }
}

main().catch((err) => {
  console.error("[backfill] Fatal:", err);
  process.exit(1);
});
