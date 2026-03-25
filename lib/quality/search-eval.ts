/**
 * SEARCH QUALITY EVAL — Automated (Tier 1 + DB Audit)
 *
 * Lightweight, cron-safe version of the full search-eval harness.
 * Runs Tier 1 (deterministic search checks) and DB audit (ground truth
 * existence/enrichment/rating accuracy) with zero AI cost.
 *
 * Results stored in quality_health_log alongside the scorecard.
 */

import { getAdminClient } from "@/lib/supabase/admin";

// ── Ground truth: top bestsellers with verified ratings ──

interface GroundTruthBook {
  title: string;
  author: string;
  goodreadsRating: number;
}

const GROUND_TRUTH: GroundTruthBook[] = [
  { title: "Fourth Wing", author: "Rebecca Yarros", goodreadsRating: 4.59 },
  { title: "A Court of Thorns and Roses", author: "Sarah J. Maas", goodreadsRating: 4.19 },
  { title: "Iron Flame", author: "Rebecca Yarros", goodreadsRating: 4.31 },
  { title: "A Court of Mist and Fury", author: "Sarah J. Maas", goodreadsRating: 4.61 },
  { title: "A Court of Silver Flames", author: "Sarah J. Maas", goodreadsRating: 4.44 },
  { title: "Onyx Storm", author: "Rebecca Yarros", goodreadsRating: 4.72 },
  { title: "Quicksilver", author: "Callie Hart", goodreadsRating: 4.48 },
  { title: "The Serpent and the Wings of Night", author: "Carissa Broadbent", goodreadsRating: 4.22 },
  { title: "Powerless", author: "Lauren Roberts", goodreadsRating: 3.94 },
  { title: "From Blood and Ash", author: "Jennifer L. Armentrout", goodreadsRating: 4.04 },
  { title: "Divine Rivals", author: "Rebecca Ross", goodreadsRating: 4.22 },
  { title: "The Cruel Prince", author: "Holly Black", goodreadsRating: 4.04 },
  { title: "One Dark Window", author: "Rachel Gillig", goodreadsRating: 4.29 },
  { title: "Bride", author: "Ali Hazelwood", goodreadsRating: 4.18 },
  { title: "Spark of the Everflame", author: "Penn Cole", goodreadsRating: 4.27 },
  { title: "Haunting Adeline", author: "H. D. Carlton", goodreadsRating: 0 },
  { title: "The Love Hypothesis", author: "Ali Hazelwood", goodreadsRating: 0 },
  { title: "It Ends with Us", author: "Colleen Hoover", goodreadsRating: 0 },
  { title: "Icebreaker", author: "Hannah Grace", goodreadsRating: 0 },
  { title: "Funny Story", author: "Emily Henry", goodreadsRating: 0 },
];

// ── Search API call ──

interface SearchResult {
  id: string;
  title: string;
  author: string;
  goodreadsId: string | null;
  coverUrl: string | null;
  goodreadsRating: number | null;
}

async function runSearch(query: string, baseUrl: string): Promise<SearchResult[]> {
  const url = `${baseUrl}/api/books/search?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.books || []).map((b: Record<string, unknown>) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      goodreadsId: b.goodreadsId ?? null,
      coverUrl: b.coverUrl ?? null,
      goodreadsRating: b.goodreadsRating ?? null,
    }));
  } catch {
    return [];
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

// ── Tier 1: Deterministic search checks ──

interface SearchCheck {
  query: string;
  passed: boolean;
  detail: string;
}

async function runTier1Checks(baseUrl: string): Promise<SearchCheck[]> {
  const checks: SearchCheck[] = [];
  const booksWithRatings = GROUND_TRUTH.filter(b => b.goodreadsRating > 0).slice(0, 15);

  for (const gt of booksWithRatings) {
    const results = await runSearch(gt.title, baseUrl);

    if (results.length === 0) {
      checks.push({
        query: gt.title,
        passed: false,
        detail: `"${gt.title}" returned zero results`,
      });
      continue;
    }

    // Check: ground truth book in top 3
    const top3 = results.slice(0, 3).map(r => normalize(r.title));
    const titleNorm = normalize(gt.title);
    const found = top3.some(t =>
      t.includes(titleNorm) || titleNorm.split(" ").every(w => t.includes(w))
    );

    checks.push({
      query: gt.title,
      passed: found,
      detail: found
        ? `"${gt.title}" found in top 3`
        : `"${gt.title}" NOT in top 3. Got: ${results.slice(0, 3).map(r => r.title).join(", ")}`,
    });

    // Check: rating accuracy
    const match = results.find(r =>
      normalize(r.title).includes(titleNorm) || titleNorm.includes(normalize(r.title))
    );
    if (match?.goodreadsRating && gt.goodreadsRating > 0) {
      const diff = Math.abs(match.goodreadsRating - gt.goodreadsRating);
      checks.push({
        query: `${gt.title} (rating)`,
        passed: diff <= 0.3,
        detail: diff <= 0.3
          ? `Rating ${match.goodreadsRating} vs GT ${gt.goodreadsRating} (diff ${diff.toFixed(2)})`
          : `Rating DRIFT: ours=${match.goodreadsRating}, GT=${gt.goodreadsRating}, diff=${diff.toFixed(2)}`,
      });
    }
  }

  return checks;
}

// ── DB Audit: ground truth books exist and are enriched ──

interface DbCheck {
  book: string;
  passed: boolean;
  detail: string;
}

async function runDbAudit(): Promise<DbCheck[]> {
  const supabase = getAdminClient();
  const checks: DbCheck[] = [];

  for (const gt of GROUND_TRUTH.slice(0, 20)) {
    const { data: books } = await supabase
      .from("books")
      .select("id, title, goodreads_id, cover_url, enrichment_status")
      .ilike("title", `%${gt.title.replace(/'/g, "''")}%`)
      .limit(3);

    if (!books || books.length === 0) {
      checks.push({ book: gt.title, passed: false, detail: "Not found in DB" });
      continue;
    }

    const book = books[0];
    const issues: string[] = [];

    if (!book.goodreads_id) issues.push("no GR ID");
    if (!book.cover_url) issues.push("no cover");
    if (book.enrichment_status !== "complete") issues.push(`enrichment=${book.enrichment_status}`);

    // Check rating accuracy if we have ground truth
    if (gt.goodreadsRating > 0) {
      const { data: rating } = await supabase
        .from("book_ratings")
        .select("rating")
        .eq("book_id", book.id as string)
        .eq("source", "goodreads")
        .single();

      if (rating?.rating) {
        const diff = Math.abs(parseFloat(rating.rating as string) - gt.goodreadsRating);
        if (diff > 0.3) issues.push(`GR rating drift: ${rating.rating} vs ${gt.goodreadsRating}`);
      } else {
        issues.push("no GR rating in DB");
      }
    }

    checks.push({
      book: gt.title,
      passed: issues.length === 0,
      detail: issues.length === 0 ? "OK" : issues.join(", "),
    });
  }

  return checks;
}

// ── Main entry point ──

export interface SearchEvalResult {
  runAt: string;
  searchChecks: { total: number; passed: number; failed: number; details: SearchCheck[] };
  dbChecks: { total: number; passed: number; failed: number; details: DbCheck[] };
  overallPass: boolean;
}

export async function runSearchEval(baseUrl: string): Promise<SearchEvalResult> {
  const [searchChecks, dbChecks] = await Promise.all([
    runTier1Checks(baseUrl),
    runDbAudit(),
  ]);

  const searchPassed = searchChecks.filter(c => c.passed).length;
  const dbPassed = dbChecks.filter(c => c.passed).length;

  return {
    runAt: new Date().toISOString(),
    searchChecks: {
      total: searchChecks.length,
      passed: searchPassed,
      failed: searchChecks.length - searchPassed,
      details: searchChecks,
    },
    dbChecks: {
      total: dbChecks.length,
      passed: dbPassed,
      failed: dbChecks.length - dbPassed,
      details: dbChecks,
    },
    overallPass: searchChecks.every(c => c.passed) && dbChecks.every(c => c.passed),
  };
}
