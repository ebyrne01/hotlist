/**
 * Search Quality Eval Harness — Three-tier evaluation
 *
 * Tier 1: DETERMINISTIC (free, instant)
 *   Searches for known bestsellers and asserts the right book appears.
 *   Compares DB ratings against canonical ground-truth ratings.
 *   No AI needed — just string matching + math.
 *
 * Tier 2: DATA AUDIT (free, instant)
 *   Checks every search result for red flags:
 *   - No Goodreads ID (phantom risk)
 *   - No cover image
 *   - No ratings at all
 *   - Suspiciously old/new publish date
 *   - Junk title/author patterns
 *
 * Tier 3: AI RELEVANCE (Sonnet, ~$0.01/query)
 *   For NL/vibe queries, has Sonnet evaluate whether results match intent.
 *   Only runs for discovery/comparison/vibe queries (not title lookups).
 *
 * Usage:
 *   npx @dotenvx/dotenvx run -f .env.local -- npx tsx scripts/search-eval.ts
 *   npx @dotenvx/dotenvx run -f .env.local -- npx tsx scripts/search-eval.ts --category nl
 *   npx @dotenvx/dotenvx run -f .env.local -- npx tsx scripts/search-eval.ts --category titles
 *   npx @dotenvx/dotenvx run -f .env.local -- npx tsx scripts/search-eval.ts --category audit
 *   npx @dotenvx/dotenvx run -f .env.local -- npx tsx scripts/search-eval.ts --query "enemies to lovers fae"
 *   npx @dotenvx/dotenvx run -f .env.local -- npx tsx scripts/search-eval.ts --tier 1  # deterministic only (free)
 *
 * Output: scripts/search-eval-results.json + console summary
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ══════════════════════════════════════════════════════
// GROUND TRUTH — canonical bestseller data
// ══════════════════════════════════════════════════════

interface GroundTruthBook {
  title: string;
  author: string;
  goodreadsRating: number;
  amazonRating: number;
  romanceIoRating: number | null;
}

/**
 * Bestseller ground truth — from Erin's manually verified spreadsheet
 * (Bugs and FR Backlog > Bestsellers tab, master list with 3-source ratings).
 *
 * Used for:
 * - Deterministic search assertions: "search for X → expect Y in top 3"
 * - Rating accuracy: "our GR rating for Y should be within 0.15 of Z"
 * - DB audit: "these 100 books MUST exist and be fully enriched"
 */
const GROUND_TRUTH: GroundTruthBook[] = [
  { title: "Fourth Wing", author: "Rebecca Yarros", goodreadsRating: 4.59, amazonRating: 4.8, romanceIoRating: 4.47 },
  { title: "A Court of Thorns and Roses", author: "Sarah J. Maas", goodreadsRating: 4.19, amazonRating: 4.7, romanceIoRating: 4.19 },
  { title: "Iron Flame", author: "Rebecca Yarros", goodreadsRating: 4.31, amazonRating: 4.7, romanceIoRating: 4.21 },
  { title: "A Court of Mist and Fury", author: "Sarah J. Maas", goodreadsRating: 4.61, amazonRating: 4.8, romanceIoRating: 4.61 },
  { title: "A Court of Wings and Ruin", author: "Sarah J. Maas", goodreadsRating: 4.47, amazonRating: 4.8, romanceIoRating: 4.47 },
  { title: "A Court of Silver Flames", author: "Sarah J. Maas", goodreadsRating: 4.44, amazonRating: 4.8, romanceIoRating: 4.44 },
  { title: "A Court of Frost and Starlight", author: "Sarah J. Maas", goodreadsRating: 3.82, amazonRating: 4.5, romanceIoRating: 3.82 },
  { title: "Onyx Storm", author: "Rebecca Yarros", goodreadsRating: 4.72, amazonRating: 4.8, romanceIoRating: 4.72 },
  { title: "Quicksilver", author: "Callie Hart", goodreadsRating: 4.48, amazonRating: 4.6, romanceIoRating: 4.48 },
  { title: "The Serpent and the Wings of Night", author: "Carissa Broadbent", goodreadsRating: 4.22, amazonRating: 4.6, romanceIoRating: 4.23 },
  { title: "Powerless", author: "Lauren Roberts", goodreadsRating: 3.94, amazonRating: 4.6, romanceIoRating: 3.94 },
  { title: "Throne of Glass", author: "Sarah J. Maas", goodreadsRating: 4.19, amazonRating: 4.7, romanceIoRating: 4.19 },
  { title: "From Blood and Ash", author: "Jennifer L. Armentrout", goodreadsRating: 4.04, amazonRating: 4.6, romanceIoRating: 4.04 },
  { title: "House of Earth and Blood", author: "Sarah J. Maas", goodreadsRating: 4.21, amazonRating: 4.7, romanceIoRating: 4.21 },
  { title: "Once Upon a Broken Heart", author: "Stephanie Garber", goodreadsRating: 4.15, amazonRating: 4.7, romanceIoRating: 4.15 },
  { title: "One Dark Window", author: "Rachel Gillig", goodreadsRating: 4.29, amazonRating: 4.7, romanceIoRating: 4.29 },
  { title: "The Cruel Prince", author: "Holly Black", goodreadsRating: 4.04, amazonRating: 4.6, romanceIoRating: 4.04 },
  { title: "Divine Rivals", author: "Rebecca Ross", goodreadsRating: 4.22, amazonRating: 4.7, romanceIoRating: 4.22 },
  { title: "When the Moon Hatched", author: "Sarah A. Parker", goodreadsRating: 4.14, amazonRating: 4.5, romanceIoRating: 4.14 },
  { title: "Crown of Midnight", author: "Sarah J. Maas", goodreadsRating: 4.34, amazonRating: 4.8, romanceIoRating: 4.34 },
  { title: "Heartless Hunter", author: "Kristen Ciccarelli", goodreadsRating: 4.31, amazonRating: 4.7, romanceIoRating: 4.31 },
  { title: "Heir of Fire", author: "Sarah J. Maas", goodreadsRating: 4.46, amazonRating: 4.8, romanceIoRating: 4.46 },
  { title: "Bride", author: "Ali Hazelwood", goodreadsRating: 4.18, amazonRating: 4.4, romanceIoRating: 4.18 },
  { title: "Spark of the Everflame", author: "Penn Cole", goodreadsRating: 4.27, amazonRating: 4.6, romanceIoRating: 4.27 },
  { title: "A Kingdom of Flesh and Fire", author: "Jennifer L. Armentrout", goodreadsRating: 4.21, amazonRating: 4.7, romanceIoRating: 4.21 },
  { title: "Lightlark", author: "Alex Aster", goodreadsRating: 3.61, amazonRating: 4.2, romanceIoRating: 3.61 },
  { title: "Assistant to the Villain", author: "Hannah Nicole Maehrer", goodreadsRating: 3.86, amazonRating: 4.4, romanceIoRating: 3.86 },
  { title: "Kingdom of the Wicked", author: "Kerri Maniscalco", goodreadsRating: 3.96, amazonRating: 4.5, romanceIoRating: 3.96 },
  { title: "A Fate Inked in Blood", author: "Danielle L. Jensen", goodreadsRating: 4.11, amazonRating: 4.6, romanceIoRating: 4.11 },
  { title: "The Bridge Kingdom", author: "Danielle L. Jensen", goodreadsRating: 4.16, amazonRating: 4.6, romanceIoRating: 4.16 },
  { title: "Gild", author: "Raven Kennedy", goodreadsRating: 3.53, amazonRating: 4.3, romanceIoRating: 3.53 },
  { title: "Radiance", author: "Grace Draven", goodreadsRating: 4.03, amazonRating: 4.6, romanceIoRating: 4.03 },
  { title: "Empire of the Vampire", author: "Jay Kristoff", goodreadsRating: 4.37, amazonRating: 4.7, romanceIoRating: 4.37 },
  { title: "Two Twisted Crowns", author: "Rachel Gillig", goodreadsRating: 4.44, amazonRating: 4.8, romanceIoRating: 4.44 },
  { title: "The Ashes and the Star-Cursed King", author: "Carissa Broadbent", goodreadsRating: 4.32, amazonRating: 4.7, romanceIoRating: 4.32 },
  { title: "Kingdom of Ash", author: "Sarah J. Maas", goodreadsRating: 4.67, amazonRating: 4.9, romanceIoRating: 4.67 },
  { title: "Queen of Shadows", author: "Sarah J. Maas", goodreadsRating: 4.54, amazonRating: 4.8, romanceIoRating: 4.54 },
  { title: "Empire of Storms", author: "Sarah J. Maas", goodreadsRating: 4.6, amazonRating: 4.8, romanceIoRating: 4.6 },
  { title: "Haunting Adeline", author: "H. D. Carlton", goodreadsRating: 0, amazonRating: 0, romanceIoRating: null },
  { title: "Hunting Adeline", author: "H. D. Carlton", goodreadsRating: 0, amazonRating: 0, romanceIoRating: null },
  { title: "Butcher & Blackbird", author: "Brynne Weaver", goodreadsRating: 0, amazonRating: 0, romanceIoRating: null },
  { title: "The Love Hypothesis", author: "Ali Hazelwood", goodreadsRating: 0, amazonRating: 0, romanceIoRating: null },
  { title: "It Ends with Us", author: "Colleen Hoover", goodreadsRating: 0, amazonRating: 0, romanceIoRating: null },
  { title: "Icebreaker", author: "Hannah Grace", goodreadsRating: 0, amazonRating: 0, romanceIoRating: null },
  { title: "Funny Story", author: "Emily Henry", goodreadsRating: 0, amazonRating: 0, romanceIoRating: null },
  { title: "Verity", author: "Colleen Hoover", goodreadsRating: 0, amazonRating: 0, romanceIoRating: null },
  { title: "Punk 57", author: "Penelope Douglas", goodreadsRating: 0, amazonRating: 0, romanceIoRating: null },
  { title: "Credence", author: "Penelope Douglas", goodreadsRating: 0, amazonRating: 0, romanceIoRating: null },
];

/**
 * Key authors — from the Authors tab. Searching for any of these
 * should return multiple books by that author, with no junk results.
 */
const KEY_AUTHORS = [
  "Sarah J. Maas", "Rebecca Yarros", "Callie Hart", "Carissa Broadbent",
  "Lauren Roberts", "Sarah A. Parker", "Ali Hazelwood", "Jennifer L. Armentrout",
  "Rachel Gillig", "Holly Black", "Penn Cole", "Danielle L. Jensen",
  "Alex Aster", "Rebecca Ross", "Kerri Maniscalco", "Hannah Nicole Maehrer",
  "Caroline Peckham", "Scarlett St. Clair", "Raven Kennedy", "Lana Ferguson",
  "L.J. Andrews", "K.M. Shea", "Nisha J. Tuli", "C.L. Wilson",
  "Hannah Grace", "Theodora Taylor", "Grace Draven", "Karen Lynch",
  "Adalyn Grace", "J. Bree", "Tracy Wolff", "Opal Reyne",
  "Colleen Hoover", "Emily Henry", "Ana Huang", "Penelope Douglas",
  "Brynne Weaver", "H. D. Carlton", "Rina Kent", "Elle Kennedy",
  "Abby Jimenez", "Christina Lauren", "Casey McQuiston", "Emily Rath",
  "Lucy Score", "Taylor Jenkins Reid", "Shantel Tessier",
];

// ══════════════════════════════════════════════════════
// TEST QUERY SUITE
// ══════════════════════════════════════════════════════

interface TestQuery {
  query: string;
  category: "title" | "author" | "nl_trope" | "nl_spice" | "nl_vibe" | "nl_similar";
  expectation: string;
  /** For title queries: which ground truth book should appear in top 3? */
  groundTruthTitle?: string;
}

// Auto-generate title test queries from the top 20 ground truth books (those with ratings)
const TITLE_QUERIES: TestQuery[] = GROUND_TRUTH
  .filter((b) => b.goodreadsRating > 0)
  .slice(0, 20)
  .map((b) => ({
    query: b.title,
    category: "title" as const,
    expectation: `${b.title} by ${b.author} should be #1.`,
    groundTruthTitle: b.title,
  }));

// Auto-generate author test queries from KEY_AUTHORS (first 15 for speed)
const AUTHOR_QUERIES: TestQuery[] = KEY_AUTHORS.slice(0, 15).map((name) => ({
  query: name,
  category: "author" as const,
  expectation: `Multiple books by ${name}. All results should be real books by this author. No study guides or summaries.`,
}));

const TEST_QUERIES: TestQuery[] = [
  ...TITLE_QUERIES,
  ...AUTHOR_QUERIES,

  // ── NL: trope-based (Tier 2 + Tier 3) ──
  { query: "enemies to lovers", category: "nl_trope", expectation: "Romance books with enemies-to-lovers trope. 10+ results." },
  { query: "slow burn forced proximity", category: "nl_trope", expectation: "Slow-burn and/or forced proximity romance books." },
  { query: "fae enemies to lovers", category: "nl_trope", expectation: "Romantasy with fae + enemies-to-lovers." },
  { query: "dark romance mafia", category: "nl_trope", expectation: "Dark romance with mafia/organized crime." },
  { query: "grumpy sunshine small town", category: "nl_trope", expectation: "Contemporary romance — grumpy/sunshine + small-town." },

  // ── NL: spice-based ──
  { query: "spicy enemies to lovers", category: "nl_spice", expectation: "Steamy (3+ spice) enemies-to-lovers." },
  { query: "clean contemporary standalone", category: "nl_spice", expectation: "Clean/sweet standalones." },
  { query: "highly rated slow burn", category: "nl_spice", expectation: "Well-rated (4.0+) slow-burn books." },

  // ── NL: vibe/mood ──
  { query: "what's trending in dark romance", category: "nl_vibe", expectation: "Currently trending dark romance." },
  { query: "cozy holiday romance", category: "nl_vibe", expectation: "Cozy holiday/Christmas romance." },
  { query: "angsty second chance romance", category: "nl_vibe", expectation: "Angsty second-chance romance." },

  // ── NL: similar-to ──
  { query: "something like ACOTAR but darker", category: "nl_similar", expectation: "Darker romantasy similar to ACOTAR." },
  { query: "books like The Love Hypothesis", category: "nl_similar", expectation: "Contemporary romance with STEM/fake-dating vibes." },
];

// ══════════════════════════════════════════════════════
// SEARCH EXECUTION
// ══════════════════════════════════════════════════════

interface SearchResult {
  id: string;
  title: string;
  author: string;
  goodreadsId: string | null;
  coverUrl: string | null;
  goodreadsRating: number | null;
  ratingCount: number | null;
  spiceLevel: number | null;
  tropes: string[];
  publishedYear: number | null;
}

async function runSearch(query: string): Promise<{
  results: SearchResult[];
  intentType: string;
  filters: Record<string, unknown> | null;
  latencyMs: number;
}> {
  const startTime = Date.now();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = `${baseUrl}/api/books/search?q=${encodeURIComponent(query)}`;

  const res = await fetch(url);
  const latencyMs = Date.now() - startTime;

  if (!res.ok) {
    return { results: [], intentType: "error", filters: null, latencyMs };
  }

  const data = await res.json();
  const results: SearchResult[] = (data.books || []).map((b: Record<string, unknown>) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    goodreadsId: b.goodreadsId ?? null,
    coverUrl: b.coverUrl ?? null,
    goodreadsRating: b.goodreadsRating ?? null,
    ratingCount: b.ratingCount ?? null,
    spiceLevel: b.spiceLevel ?? null,
    tropes: b.topTropes ?? [],
    publishedYear: b.publishedYear ?? null,
  }));

  return { results, intentType: data.intent || "unknown", filters: data.filters || null, latencyMs };
}

// ══════════════════════════════════════════════════════
// TIER 1: DETERMINISTIC CHECKS (free)
// ══════════════════════════════════════════════════════

interface DeterministicResult {
  passed: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

function runDeterministicChecks(
  testQuery: TestQuery,
  results: SearchResult[]
): DeterministicResult {
  const checks: DeterministicResult["checks"] = [];

  // Check 1: Non-empty results
  checks.push({
    name: "has_results",
    passed: results.length > 0,
    detail: results.length > 0 ? `${results.length} results` : "ZERO results returned",
  });

  // Check 2: Ground truth book appears in top 3 (if specified)
  if (testQuery.groundTruthTitle) {
    const gt = GROUND_TRUTH.find((b) =>
      normalize(b.title).includes(normalize(testQuery.groundTruthTitle!)) ||
      normalize(testQuery.groundTruthTitle!).includes(normalize(b.title))
    );

    const top3Titles = results.slice(0, 3).map((r) => normalize(r.title));
    const found = top3Titles.some((t) =>
      normalize(testQuery.groundTruthTitle!).split(" ").every((w) => t.includes(w)) ||
      t.includes(normalize(testQuery.groundTruthTitle!))
    );

    checks.push({
      name: "ground_truth_in_top3",
      passed: found,
      detail: found
        ? `"${testQuery.groundTruthTitle}" found in top 3`
        : `"${testQuery.groundTruthTitle}" NOT in top 3. Got: ${results.slice(0, 3).map((r) => `"${r.title}"`).join(", ") || "nothing"}`,
    });

    // Check 3: Rating accuracy (if ground truth book found in results)
    if (gt) {
      const matchedResult = results.find((r) =>
        normalize(r.title).includes(normalize(gt.title)) ||
        normalize(gt.title).includes(normalize(r.title))
      );

      if (matchedResult?.goodreadsRating) {
        const diff = Math.abs(matchedResult.goodreadsRating - gt.goodreadsRating);
        checks.push({
          name: "rating_accuracy",
          passed: diff <= 0.2,
          detail: diff <= 0.2
            ? `GR rating ${matchedResult.goodreadsRating} vs ground truth ${gt.goodreadsRating} (diff ${diff.toFixed(2)})`
            : `GR rating DRIFT: ours=${matchedResult.goodreadsRating}, canonical=${gt.goodreadsRating}, diff=${diff.toFixed(2)}`,
        });
      }
    }
  }

  // Check 4: No results without Goodreads ID in the top 5 (title/author queries)
  if (testQuery.category === "title" || testQuery.category === "author") {
    const noGrId = results.slice(0, 5).filter((r) => !r.goodreadsId);
    checks.push({
      name: "top5_have_goodreads_id",
      passed: noGrId.length === 0,
      detail: noGrId.length === 0
        ? "All top 5 have Goodreads IDs"
        : `${noGrId.length} of top 5 missing Goodreads ID: ${noGrId.map((r) => `"${r.title}"`).join(", ")}`,
    });
  }

  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}

// ══════════════════════════════════════════════════════
// TIER 2: DATA AUDIT (free)
// ══════════════════════════════════════════════════════

const JUNK_TITLE_PATTERNS = [
  /study guide/i, /summary of/i, /sparknotes/i, /cliffsnotes/i,
  /bookcaps/i, /supersummary/i, /bookhabits/i, /novel\s+unit/i,
  /teacher.?s?\s+guide/i, /lesson\s+plan/i, /curriculum/i,
  /\bpodcast\b/i, /\bfigurine\b/i, /\bbookmark\b/i,
  /conversation starters/i, /reading guide/i,
];

const JUNK_AUTHOR_PATTERNS =
  /^(supersummary|bookhabits|bookcaps|readtrepreneur|worth\s*books|bright\s*summaries|instaread|unknown\s+author)$/i;

interface DataAuditResult {
  issues: string[];
  warnings: string[];
}

function auditResultData(results: SearchResult[]): DataAuditResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  for (const r of results) {
    const prefix = `"${r.title}" by ${r.author}`;

    // Junk title
    if (JUNK_TITLE_PATTERNS.some((p) => p.test(r.title))) {
      issues.push(`${prefix} — JUNK TITLE detected in results`);
    }

    // Junk author
    if (JUNK_AUTHOR_PATTERNS.test(r.author)) {
      issues.push(`${prefix} — JUNK AUTHOR detected`);
    }

    // No cover
    if (!r.coverUrl) {
      warnings.push(`${prefix} — no cover image`);
    }

    // No ratings at all
    if (r.goodreadsRating === null && r.ratingCount === null) {
      warnings.push(`${prefix} — no ratings data`);
    }

    // No Goodreads ID
    if (!r.goodreadsId) {
      warnings.push(`${prefix} — no Goodreads ID (phantom risk)`);
    }

    // Suspicious publish year
    if (r.publishedYear && (r.publishedYear < 1950 || r.publishedYear > new Date().getFullYear() + 1)) {
      issues.push(`${prefix} — suspicious publish year: ${r.publishedYear}`);
    }
  }

  return { issues, warnings };
}

// ══════════════════════════════════════════════════════
// TIER 3: AI RELEVANCE EVAL (Sonnet, ~$0.01/query)
// ══════════════════════════════════════════════════════

interface AiEvalResult {
  score: number; // 1-5
  issues: string[];
  summary: string;
}

async function evaluateWithAi(
  testQuery: TestQuery,
  searchData: { results: SearchResult[]; intentType: string; filters: Record<string, unknown> | null }
): Promise<AiEvalResult> {
  const resultsText = searchData.results.length === 0
    ? "NO RESULTS RETURNED"
    : searchData.results
        .map((r, i) => {
          const parts = [
            `${i + 1}. "${r.title}" by ${r.author}`,
            r.goodreadsRating ? `GR: ${r.goodreadsRating}` : "No GR rating",
            r.ratingCount ? `(${r.ratingCount} ratings)` : "",
            r.spiceLevel ? `Spice: ${r.spiceLevel}` : "",
            r.tropes.length > 0 ? `Tropes: ${r.tropes.join(", ")}` : "",
            r.goodreadsId ? "" : "NO GOODREADS ID",
            r.publishedYear ? `Pub: ${r.publishedYear}` : "",
          ].filter(Boolean);
          return parts.join(" | ");
        })
        .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: `You are a romance book search quality evaluator. Be strict.

QUERY: "${testQuery.query}"
CATEGORY: ${testQuery.category}
EXPECTED: ${testQuery.expectation}
INTENT: ${searchData.intentType}
${searchData.filters ? `FILTERS: ${JSON.stringify(searchData.filters)}` : ""}

RESULTS (${searchData.results.length}):
${resultsText}

Score 1-5. Check: relevance to query, result quality, ranking order, data completeness.
A score of 5 = all results are relevant real books matching the intent.
A score of 3 = mostly relevant but some irrelevant or low-quality results.
A score of 1 = results are broken, empty, or mostly irrelevant.

Respond with ONLY valid JSON:
{"score": <1-5>, "issues": ["issue1", "issue2"], "summary": "one-line verdict"}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";

  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return { score: 0, issues: ["Failed to parse AI eval response"], summary: "Eval error" };
  }
}

// ══════════════════════════════════════════════════════
// TIER BONUS: DB GROUND TRUTH AUDIT (free, no search)
// ══════════════════════════════════════════════════════

interface DbAuditResult {
  book: string;
  checks: { name: string; passed: boolean; detail: string }[];
}

async function auditGroundTruthInDb(): Promise<DbAuditResult[]> {
  const results: DbAuditResult[] = [];

  // Only audit books that have canonical ratings (skip the 0-rated ones)
  const booksWithRatings = GROUND_TRUTH.filter((b) => b.goodreadsRating > 0);
  for (const gt of booksWithRatings.slice(0, 30)) {
    const checks: DbAuditResult["checks"] = [];

    // Find book in DB by title
    const { data: books } = await supabase
      .from("books")
      .select("id, title, author, goodreads_id, cover_url, enrichment_status, published_year")
      .ilike("title", `%${gt.title.replace(/'/g, "''")}%`)
      .limit(3);

    if (!books || books.length === 0) {
      checks.push({ name: "exists_in_db", passed: false, detail: `"${gt.title}" not found in DB` });
      results.push({ book: `${gt.title} — ${gt.author}`, checks });
      continue;
    }

    const book = books[0];
    checks.push({ name: "exists_in_db", passed: true, detail: `Found: id=${book.id}` });

    // Has Goodreads ID
    checks.push({
      name: "has_goodreads_id",
      passed: !!book.goodreads_id,
      detail: book.goodreads_id ? `GR ID: ${book.goodreads_id}` : "Missing Goodreads ID",
    });

    // Has cover
    checks.push({
      name: "has_cover",
      passed: !!book.cover_url,
      detail: book.cover_url ? "Has cover" : "Missing cover",
    });

    // Enrichment status
    checks.push({
      name: "enrichment_complete",
      passed: book.enrichment_status === "complete",
      detail: `Status: ${book.enrichment_status || "null"}`,
    });

    // Check Goodreads rating in book_ratings
    const { data: ratings } = await supabase
      .from("book_ratings")
      .select("rating")
      .eq("book_id", book.id)
      .eq("source", "goodreads")
      .single();

    if (ratings?.rating) {
      const diff = Math.abs(parseFloat(ratings.rating) - gt.goodreadsRating);
      checks.push({
        name: "gr_rating_accuracy",
        passed: diff <= 0.2,
        detail: `Ours: ${ratings.rating}, Canonical: ${gt.goodreadsRating}, Diff: ${diff.toFixed(2)}`,
      });
    } else {
      checks.push({
        name: "gr_rating_accuracy",
        passed: false,
        detail: `No Goodreads rating in DB (canonical: ${gt.goodreadsRating})`,
      });
    }

    results.push({ book: `${gt.title} — ${gt.author}`, checks });
  }

  return results;
}

// ══════════════════════════════════════════════════════
// MAIN RUNNER
// ══════════════════════════════════════════════════════

interface FullEvalResult {
  query: string;
  category: string;
  intentType: string;
  filters: Record<string, unknown> | null;
  resultCount: number;
  latencyMs: number;
  topResults: { title: string; author: string }[];
  tier1: DeterministicResult;
  tier2: DataAuditResult;
  tier3: AiEvalResult | null; // null for title/author queries when --tier 1
  finalScore: number; // composite 1-5
}

function computeFinalScore(
  tier1: DeterministicResult,
  tier2: DataAuditResult,
  tier3: AiEvalResult | null,
  resultCount: number
): number {
  if (resultCount === 0) return 1;

  let score = 5;

  // Tier 1 failures are severe
  const failedChecks = tier1.checks.filter((c) => !c.passed);
  score -= failedChecks.length * 1.0;

  // Tier 2 issues are moderate, warnings are minor
  score -= tier2.issues.length * 0.5;
  score -= Math.min(tier2.warnings.length, 3) * 0.15;

  // Tier 3 AI score blends in (if available)
  if (tier3) {
    score = score * 0.5 + tier3.score * 0.5;
  }

  return Math.max(1, Math.min(5, Math.round(score * 10) / 10));
}

async function main() {
  const args = process.argv.slice(2);

  let categoryFilter: string | null = null;
  let singleQuery: string | null = null;
  let maxTier = 3;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--category" && args[i + 1]) { categoryFilter = args[i + 1]; i++; }
    else if (args[i] === "--query" && args[i + 1]) { singleQuery = args[i + 1]; i++; }
    else if (args[i] === "--tier" && args[i + 1]) { maxTier = parseInt(args[i + 1]); i++; }
  }

  // ── Build query list ──
  let queries: TestQuery[];
  if (singleQuery) {
    queries = [{ query: singleQuery, category: "nl_vibe", expectation: "Results should be relevant romance books matching the query." }];
  } else if (categoryFilter === "audit") {
    // Special mode: just run DB audit
    console.log("\n📋 DB Ground Truth Audit\n" + "─".repeat(70));
    const dbResults = await auditGroundTruthInDb();
    let totalPassed = 0;
    let totalFailed = 0;

    for (const r of dbResults) {
      const allPassed = r.checks.every((c) => c.passed);
      const emoji = allPassed ? "✅" : "❌";
      console.log(`  ${emoji} ${r.book}`);
      for (const c of r.checks) {
        if (!c.passed) {
          console.log(`     ↳ FAIL ${c.name}: ${c.detail}`);
          totalFailed++;
        } else {
          totalPassed++;
        }
      }
    }

    console.log(`\n📊 ${totalPassed} passed, ${totalFailed} failed across ${dbResults.length} books\n`);

    fs.writeFileSync(
      "scripts/search-eval-results.json",
      JSON.stringify({ runAt: new Date().toISOString(), type: "db_audit", results: dbResults }, null, 2)
    );
    return;
  } else if (categoryFilter) {
    const catMap: Record<string, string[]> = {
      titles: ["title"], authors: ["author"],
      nl: ["nl_trope", "nl_spice", "nl_vibe", "nl_similar"],
      tropes: ["nl_trope"], spice: ["nl_spice"], vibes: ["nl_vibe"], similar: ["nl_similar"],
    };
    const cats = catMap[categoryFilter] || [categoryFilter];
    queries = TEST_QUERIES.filter((q) => cats.includes(q.category));
    if (queries.length === 0) {
      console.error(`No queries match "${categoryFilter}". Options: titles, authors, nl, tropes, spice, vibes, similar, audit`);
      process.exit(1);
    }
  } else {
    queries = TEST_QUERIES;
  }

  const useAi = maxTier >= 3;
  const costEstimate = useAi ? queries.filter((q) => q.category.startsWith("nl_")).length * 0.01 : 0;

  console.log(`\n🔍 Search Quality Eval — ${queries.length} queries (tiers 1-${maxTier})${useAi ? ` ~$${costEstimate.toFixed(2)} Sonnet` : " (free)"}\n`);
  console.log("─".repeat(70));

  const results: FullEvalResult[] = [];
  let totalScore = 0;
  let totalIssues = 0;

  for (const testQuery of queries) {
    process.stdout.write(`  ${testQuery.query.padEnd(45)}`);

    const searchData = await runSearch(testQuery.query);

    // Tier 1: Deterministic
    const tier1 = runDeterministicChecks(testQuery, searchData.results);

    // Tier 2: Data audit
    const tier2 = auditResultData(searchData.results);

    // Tier 3: AI eval (only for NL queries, only if tier >= 3)
    let tier3: AiEvalResult | null = null;
    if (useAi && testQuery.category.startsWith("nl_")) {
      tier3 = await evaluateWithAi(testQuery, searchData);
    }

    const finalScore = computeFinalScore(tier1, tier2, tier3, searchData.results.length);

    const fullResult: FullEvalResult = {
      query: testQuery.query,
      category: testQuery.category,
      intentType: searchData.intentType,
      filters: searchData.filters,
      resultCount: searchData.results.length,
      latencyMs: searchData.latencyMs,
      topResults: searchData.results.slice(0, 5).map((r) => ({ title: r.title, author: r.author })),
      tier1,
      tier2,
      tier3,
      finalScore,
    };

    results.push(fullResult);
    totalScore += finalScore;
    totalIssues += tier2.issues.length + tier1.checks.filter((c) => !c.passed).length + (tier3?.issues.length ?? 0);

    // Console output
    const emoji = finalScore >= 4 ? "✅" : finalScore >= 3 ? "⚠️" : "❌";
    console.log(`${emoji} ${finalScore}/5  (${searchData.results.length} results, ${searchData.latencyMs}ms)`);

    // Show failures
    for (const c of tier1.checks.filter((c) => !c.passed)) {
      console.log(`     ↳ T1 FAIL: ${c.detail}`);
    }
    for (const issue of tier2.issues) {
      console.log(`     ↳ T2 JUNK: ${issue}`);
    }
    if (tier3 && tier3.score <= 3) {
      console.log(`     ↳ T3 AI (${tier3.score}/5): ${tier3.summary}`);
      for (const issue of tier3.issues) {
        console.log(`       • ${issue}`);
      }
    }
  }

  // ── Summary ──
  console.log("\n" + "─".repeat(70));
  const avgScore = (totalScore / queries.length).toFixed(1);
  const passing = results.filter((r) => r.finalScore >= 4).length;
  const warning = results.filter((r) => r.finalScore >= 3 && r.finalScore < 4).length;
  const failing = results.filter((r) => r.finalScore < 3).length;

  console.log(`\n📊 avg ${avgScore}/5  |  ✅ ${passing} pass  |  ⚠️ ${warning} warn  |  ❌ ${failing} fail  |  ${totalIssues} issues\n`);

  // Worst queries
  const worst = results.filter((r) => r.finalScore < 4).sort((a, b) => a.finalScore - b.finalScore);
  if (worst.length > 0) {
    console.log("Needs attention:");
    for (const w of worst.slice(0, 8)) {
      const aiNote = w.tier3 ? ` — AI: ${w.tier3.summary}` : "";
      const t1Fails = w.tier1.checks.filter((c) => !c.passed).map((c) => c.name).join(", ");
      console.log(`  ${w.finalScore}/5  "${w.query}" ${t1Fails ? `[${t1Fails}]` : ""}${aiNote}`);
    }
    console.log();
  }

  // Write results
  fs.writeFileSync(
    "scripts/search-eval-results.json",
    JSON.stringify({
      runAt: new Date().toISOString(),
      queryCount: queries.length,
      maxTier,
      avgScore: parseFloat(avgScore),
      passing,
      warning,
      failing,
      totalIssues,
      results,
    }, null, 2)
  );
  console.log(`Full results → scripts/search-eval-results.json`);
}

main().catch((err) => {
  console.error("Eval harness failed:", err);
  process.exit(1);
});
