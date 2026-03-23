/**
 * QUALITY RULES ENGINE
 *
 * Structural quality rules that fire on every book write/hydration.
 * Each rule checks a single field and returns a flag if the rule fires.
 * Rules are synchronous, cheap, and never call external APIs.
 *
 * Flags are written to the `quality_flags` table. The unique index on
 * (book_id, field_name, issue_type) WHERE status = 'open' prevents
 * duplicate flags — repeated checks are idempotent.
 */

import { getAdminClient } from "@/lib/supabase/admin";

// ── Types ─────────────────────────────────────────────

export interface BookForQuality {
  id: string;
  title: string;
  author: string;
  series_name: string | null;
  series_position: string | null;
  ai_synopsis: string | null;
  page_count: number | null;
  published_year: number | null;
}

interface RuleResult {
  confidence: number;
  originalValue: string;
  suggestedValue: string | null; // null = clear the field
}

type QualitySource = "rules_engine" | "haiku_scanner" | "browser_harness";
type QualityPriority = "P0" | "P1" | "P2" | "P3";

interface QualityRule {
  id: string;
  field: string;
  issueType: string;
  priority: QualityPriority;
  check: (book: BookForQuality) => RuleResult | null;
  autoFixable: boolean;
}

export interface QualityFlagInsert {
  book_id: string;
  field_name: string;
  issue_type: string;
  source: QualitySource;
  priority: QualityPriority;
  rule_id: string;
  confidence: number;
  original_value: string | null;
  suggested_value: string | null;
  auto_fixable: boolean;
}

// ── Edition artifact patterns ─────────────────────────

const SERIES_EDITION_EXACT = new Set([
  "kindle edition",
  "large print",
  "large print edition",
  "unabridged",
  "abridged",
  "audio cd",
  "audiobook",
  "hardcover",
  "paperback",
  "mass market paperback",
  "board book",
]);

const SERIES_EDITION_SUBSTRINGS = [
  "large print",
  "kindle edition",
  "special edition",
  "collector's edition",
  "anniversary edition",
  "illustrated edition",
];

// ── Publisher collection patterns ─────────────────────

const PUBLISHER_COLLECTION_REGEX_1 =
  /^(romance|love|passion|heat|fire|desire|harlequin|avon|mills\s*&?\s*boon)\s+(collection|series|bundle|library|anthology|presents|modern|blaze|desire|intrigue)\s*(vol\.?\s*\d+)?$/i;

const PUBLISHER_COLLECTION_REGEX_2 =
  /^\d+[\s-]?(book|novel|story)\s+(collection|bundle|series|set)$/i;

const PUBLISHER_COLLECTION_EXACT = new Set([
  "complete series",
  "box set",
  "complete collection",
  "the complete series",
]);

// ── Title edition patterns ───────────────────────────
// Matches edition markers in parens/brackets, anywhere in title (not just end)
const TITLE_EDITION_REGEX =
  /\s*[\(\[](large print(?:\s+edition)?|kindle edition|unabridged|abridged|a novel|a romance|a novella|special edition|anniversary edition|illustrated edition)[\)\]]/i;

// ── Title "by Author" artifact ───────────────────────
const TITLE_BY_AUTHOR_REGEX = /^by\s+\w+\s+\w+\s*[-–—:]/i;

// ── Synopsis placeholders ────────────────────────────
const SYNOPSIS_PLACEHOLDERS = [
  "synopsis not available",
  "no synopsis",
  "coming soon",
  "tbd",
  "n/a",
  "not available",
  "no description available",
  "description unavailable",
];

// ── Rules ─────────────────────────────────────────────

const RULES: QualityRule[] = [
  {
    id: "series_edition_artifact",
    field: "series_name",
    issueType: "edition_artifact",
    priority: "P1",
    autoFixable: true,
    check: (book) => {
      if (!book.series_name) return null;
      const trimmed = book.series_name.trim();
      const lower = trimmed.toLowerCase();

      if (SERIES_EDITION_EXACT.has(lower)) {
        return { confidence: 1.0, originalValue: trimmed, suggestedValue: null };
      }

      for (const sub of SERIES_EDITION_SUBSTRINGS) {
        if (lower.includes(sub)) {
          return { confidence: 1.0, originalValue: trimmed, suggestedValue: null };
        }
      }

      return null;
    },
  },

  {
    id: "series_publisher_collection",
    field: "series_name",
    issueType: "publisher_collection",
    priority: "P2",
    autoFixable: true,
    check: (book) => {
      if (!book.series_name) return null;
      const trimmed = book.series_name.trim();
      const lower = trimmed.toLowerCase();

      if (PUBLISHER_COLLECTION_EXACT.has(lower)) {
        return { confidence: 0.85, originalValue: trimmed, suggestedValue: null };
      }

      if (
        PUBLISHER_COLLECTION_REGEX_1.test(trimmed) ||
        PUBLISHER_COLLECTION_REGEX_2.test(trimmed)
      ) {
        return { confidence: 0.85, originalValue: trimmed, suggestedValue: null };
      }

      return null;
    },
  },

  {
    id: "series_numeric_only",
    field: "series_name",
    issueType: "numeric_only_series",
    priority: "P2",
    autoFixable: true,
    check: (book) => {
      if (!book.series_name) return null;
      const trimmed = book.series_name.trim();

      if (/^\d+$/.test(trimmed)) {
        return { confidence: 1.0, originalValue: trimmed, suggestedValue: null };
      }
      if (/^book\s+\d+\s+of\s+\d+$/i.test(trimmed)) {
        return { confidence: 1.0, originalValue: trimmed, suggestedValue: null };
      }
      if (/^stand-?alone$/i.test(trimmed)) {
        return { confidence: 1.0, originalValue: trimmed, suggestedValue: null };
      }

      return null;
    },
  },

  {
    id: "title_edition_artifact",
    field: "title",
    issueType: "edition_in_title",
    priority: "P0",
    autoFixable: true,
    check: (book) => {
      const match = book.title.match(TITLE_EDITION_REGEX);
      if (!match) return null;

      const cleaned = book.title.replace(TITLE_EDITION_REGEX, "").trim();
      return {
        confidence: 0.95,
        originalValue: book.title,
        suggestedValue: cleaned || null,
      };
    },
  },

  {
    id: "title_by_author_artifact",
    field: "title",
    issueType: "by_author_in_title",
    priority: "P0",
    autoFixable: false,
    check: (book) => {
      if (!TITLE_BY_AUTHOR_REGEX.test(book.title)) return null;
      return {
        confidence: 0.90,
        originalValue: book.title,
        suggestedValue: null,
      };
    },
  },

  {
    id: "synopsis_too_short",
    field: "ai_synopsis",
    issueType: "synopsis_too_short",
    priority: "P2",
    autoFixable: false,
    check: (book) => {
      if (!book.ai_synopsis) return null;
      const trimmed = book.ai_synopsis.trim();
      const lower = trimmed.toLowerCase();

      if (trimmed.length < 60) {
        return { confidence: 1.0, originalValue: trimmed, suggestedValue: null };
      }

      for (const placeholder of SYNOPSIS_PLACEHOLDERS) {
        if (lower === placeholder || lower.startsWith(placeholder)) {
          return { confidence: 1.0, originalValue: trimmed, suggestedValue: null };
        }
      }

      return null;
    },
  },

  {
    id: "implausible_page_count",
    field: "page_count",
    issueType: "implausible_page_count",
    priority: "P1",
    autoFixable: true,
    check: (book) => {
      if (book.page_count == null) return null;
      if (book.page_count < 10 || book.page_count > 5000) {
        return {
          confidence: 1.0,
          originalValue: String(book.page_count),
          suggestedValue: null,
        };
      }
      return null;
    },
  },

  {
    id: "future_publish_year",
    field: "published_year",
    issueType: "future_publish_year",
    priority: "P1",
    autoFixable: true,
    check: (book) => {
      if (book.published_year == null) return null;
      const currentYear = new Date().getFullYear();
      if (book.published_year > currentYear + 2) {
        return {
          confidence: 1.0,
          originalValue: String(book.published_year),
          suggestedValue: null,
        };
      }
      return null;
    },
  },
];

// ── Public API ────────────────────────────────────────

/**
 * Run all rules against a single book.
 * Returns an array of pending flag inserts (not yet written to DB).
 */
export function runRulesEngine(book: BookForQuality): QualityFlagInsert[] {
  const flags: QualityFlagInsert[] = [];

  for (const rule of RULES) {
    const result = rule.check(book);
    if (result) {
      flags.push({
        book_id: book.id,
        field_name: rule.field,
        issue_type: rule.issueType,
        source: "rules_engine",
        priority: rule.priority,
        rule_id: rule.id,
        confidence: result.confidence,
        original_value: result.originalValue,
        suggested_value: result.suggestedValue,
        auto_fixable: rule.autoFixable,
      });
    }
  }

  return flags;
}

// ── Hydration throttle ────────────────────────────────
// Prevents repeated quality checks on the same book during high-traffic reads.
// In-memory set of recently-checked book IDs with 5-minute TTL.
const recentlyChecked = new Map<string, number>();
const THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

function shouldSkipCheck(bookId: string): boolean {
  const lastChecked = recentlyChecked.get(bookId);
  if (lastChecked && Date.now() - lastChecked < THROTTLE_MS) {
    return true;
  }
  recentlyChecked.set(bookId, Date.now());

  // Prevent unbounded memory growth — prune old entries periodically
  if (recentlyChecked.size > 5000) {
    const cutoff = Date.now() - THROTTLE_MS;
    recentlyChecked.forEach((ts, id) => {
      if (ts < cutoff) recentlyChecked.delete(id);
    });
  }

  return false;
}

/**
 * Run rules and persist any new flags to the DB.
 * Skips flags that already exist (the unique index handles dedup).
 * Returns the count of new flags created.
 *
 * @param bookId - Book UUID to check
 * @param skipThrottle - If true, bypass the in-memory throttle (used by backfill/scan)
 */
export async function checkAndFlagBook(
  bookId: string,
  skipThrottle = false
): Promise<number> {
  if (!skipThrottle && shouldSkipCheck(bookId)) return 0;

  const supabase = getAdminClient();

  const { data: row } = await supabase
    .from("books")
    .select("id, title, author, series_name, series_position, ai_synopsis, page_count, published_year")
    .eq("id", bookId)
    .single();

  if (!row) return 0;

  const book: BookForQuality = {
    id: row.id,
    title: row.title,
    author: row.author,
    series_name: row.series_name,
    series_position: row.series_position ? String(row.series_position) : null,
    ai_synopsis: row.ai_synopsis,
    page_count: row.page_count,
    published_year: row.published_year,
  };

  const flags = runRulesEngine(book);
  if (flags.length === 0) return 0;

  let created = 0;
  for (const flag of flags) {
    const { error } = await supabase
      .from("quality_flags")
      .insert(flag);

    // 23505 = unique_violation — flag already exists, skip it
    if (error && error.code !== "23505") {
      console.warn("[quality] Failed to insert flag:", error.message);
    } else if (!error) {
      created++;
    }
  }

  if (created > 0) {
    console.log(`[quality] Created ${created} flag(s) for "${book.title}"`);
  }

  return created;
}

/**
 * Check if a Haiku-detected issue_type has been confirmed enough times
 * to be considered a graduated rule. Called from the admin resolve route.
 *
 * Graduation threshold: 5+ confirmed flags of the same issue_type
 * from the haiku_scanner in the last 90 days.
 */
export async function checkGraduationThreshold(issueType: string): Promise<boolean> {
  const supabase = getAdminClient();
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { count } = await supabase
    .from("quality_flags")
    .select("*", { count: "exact", head: true })
    .eq("issue_type", issueType)
    .eq("source", "haiku_scanner")
    .eq("status", "confirmed")
    .gte("resolved_at", cutoff);

  return (count ?? 0) >= 5;
}
