/**
 * DAILY SPICE BACKFILL CRON
 *
 * Runs LLM spice inference and review classifier backfills automatically.
 * Scheduled daily at 3 AM UTC. Each run processes a batch within the
 * 60s Vercel function limit.
 *
 * - LLM inference: up to SPICE_LLM_DAILY_LIMIT (default 100) per day
 * - Review classifier: up to 15 books per run (~3s each with Goodreads delay)
 */

import { NextResponse } from "next/server";
import { requireCronAuth, cronUnauthorized } from "@/lib/api/cron-auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { inferSpiceFromDescription } from "@/lib/spice/llm-inference";
import { classifyReviews } from "@/lib/spice/review-classifier";
import { fetchAllReviews } from "@/lib/spice/review-fetcher";

export const runtime = "nodejs";
export const maxDuration = 60;

const HIGHER_CONFIDENCE_SOURCES = ["community", "romance_io", "review_classifier"];
const REVIEW_BATCH_SIZE = 15; // ~3s per book (1.5s Goodreads delay + processing)
const LLM_BATCH_SIZE = 30; // Fast — just API calls, no scraping

export async function GET(request: Request) {
  if (!requireCronAuth(request)) {
    return cronUnauthorized();
  }

  const startTime = Date.now();
  const supabase = getAdminClient();
  const results = { llm: { processed: 0, succeeded: 0 }, reviews: { processed: 0, succeeded: 0 } };

  try {
    // ── Phase 1: LLM inference backfill (~10s) ──
    // Check daily usage
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const dailyLimit = Number(process.env.SPICE_LLM_DAILY_LIMIT) || 100;

    const { count: todayCount } = await supabase
      .from("spice_signals")
      .select("*", { count: "exact", head: true })
      .eq("source", "llm_inference")
      .gte("updated_at", todayStart.toISOString());

    const llmRemaining = dailyLimit - (todayCount ?? 0);

    if (llmRemaining > 0) {
      // Get book IDs with higher-confidence signals (skip)
      const { data: highConfRows } = await supabase
        .from("spice_signals")
        .select("book_id")
        .in("source", HIGHER_CONFIDENCE_SOURCES);
      const skipIds = new Set((highConfRows ?? []).map((r) => r.book_id));

      // Get book IDs with existing LLM inference (skip)
      const { data: existingLlm } = await supabase
        .from("spice_signals")
        .select("book_id")
        .eq("source", "llm_inference");
      for (const r of existingLlm ?? []) skipIds.add(r.book_id);

      // Fetch candidates
      const { data: llmCandidates } = await supabase
        .from("books")
        .select("id, title, author, description, genres")
        .not("description", "is", null)
        .order("created_at", { ascending: true })
        .limit(500);

      const eligible = (llmCandidates ?? []).filter(
        (b) => b.description && b.description.length >= 50 && !skipIds.has(b.id)
      );

      const llmBatch = eligible.slice(0, Math.min(LLM_BATCH_SIZE, llmRemaining));

      for (const book of llmBatch) {
        if (Date.now() - startTime > 20_000) break; // 20s budget for LLM phase

        results.llm.processed++;
        try {
          const result = await inferSpiceFromDescription({
            title: book.title,
            author: book.author,
            description: book.description!,
            genres: book.genres ?? [],
          });

          if (result) {
            await supabase.from("spice_signals").upsert(
              {
                book_id: book.id,
                source: "llm_inference",
                spice_value: result.spice,
                confidence: result.confidence,
                evidence: {
                  reasoning: result.reasoning,
                  model: "claude-haiku-4-5-20251001",
                  description_length: book.description!.length,
                  inferred_at: new Date().toISOString(),
                },
                updated_at: new Date().toISOString(),
              },
              { onConflict: "book_id,source" }
            );
            results.llm.succeeded++;
          }
        } catch {
          // Continue on individual failures
        }
      }
    }

    // ── Phase 2: Review classifier backfill (~35s) ──
    const { data: existingReview } = await supabase
      .from("spice_signals")
      .select("book_id")
      .eq("source", "review_classifier");
    const reviewSkipIds = new Set((existingReview ?? []).map((r) => r.book_id));

    const { data: reviewCandidates } = await supabase
      .from("books")
      .select("id, title, author, goodreads_url, amazon_asin")
      .not("goodreads_url", "is", null)
      .order("created_at", { ascending: true })
      .limit(500);

    const reviewEligible = (reviewCandidates ?? []).filter(
      (b) => b.goodreads_url && !reviewSkipIds.has(b.id)
    );

    const reviewBatch = reviewEligible.slice(0, REVIEW_BATCH_SIZE);

    for (const book of reviewBatch) {
      if (Date.now() - startTime > 55_000) break; // 5s buffer

      results.reviews.processed++;
      try {
        const reviews = await fetchAllReviews({
          goodreadsUrl: book.goodreads_url,
          title: book.title,
          author: book.author,
          amazonAsin: book.amazon_asin,
        });

        if (reviews.length >= 2) {
          const result = await classifyReviews(reviews, book.title, book.author);
          if (result) {
            await supabase.from("spice_signals").upsert(
              {
                book_id: book.id,
                source: "review_classifier",
                spice_value: result.spice,
                confidence: result.confidence,
                evidence: {
                  method: result.method,
                  reviews_analyzed: result.reviewsAnalyzed,
                  keyword_hits: result.keywordHits,
                  per_review_scores: result.perReviewScores,
                  reasoning: result.reasoning ?? null,
                  classified_at: new Date().toISOString(),
                },
                updated_at: new Date().toISOString(),
              },
              { onConflict: "book_id,source" }
            );
            results.reviews.succeeded++;
          }
        }
      } catch {
        // Continue on individual failures
      }
    }

    console.log(
      `[cron/spice-backfill] LLM: ${results.llm.succeeded}/${results.llm.processed}, Reviews: ${results.reviews.succeeded}/${results.reviews.processed} in ${Date.now() - startTime}ms`
    );

    return NextResponse.json(results);
  } catch (error) {
    console.error("[cron/spice-backfill] Fatal error:", error);
    return NextResponse.json({ error: "Spice backfill failed" }, { status: 500 });
  }
}
