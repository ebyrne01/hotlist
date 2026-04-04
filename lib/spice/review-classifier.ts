/**
 * REVIEW TEXT CLASSIFIER — Keyword-based spice estimation from reader reviews
 *
 * Romance readers are extremely explicit about spice levels in reviews.
 * This classifier uses keyword matching first (fast, free) with an LLM
 * fallback for ambiguous cases.
 *
 * Confidence in composite scoring: 0.6 (medium — above LLM inference,
 * below Romance.io direct data).
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAdminClient } from "@/lib/supabase/admin";

const MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_DAILY_LIMIT = 50;

/**
 * Check how many review classifier LLM fallbacks have been run today.
 */
async function getDailyReviewClassifierUsage(): Promise<number> {
  const supabase = getAdminClient();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("enrichment_queue")
    .select("*", { count: "exact", head: true })
    .eq("job_type", "review_classifier")
    .eq("status", "completed")
    .gte("completed_at", todayStart.toISOString());

  return count ?? 0;
}

const SPICE_KEYWORDS: { pattern: RegExp; spice: number; weight: number }[] = [
  // Strong high-spice indicators
  { pattern: /\berotica\b/i, spice: 5.0, weight: 2.0 },
  { pattern: /\bexplicit\b/i, spice: 4.5, weight: 1.5 },
  { pattern: /\bsmut(ty)?\b/i, spice: 4.5, weight: 1.5 },
  { pattern: /\bgraphic (sex|love)\b/i, spice: 4.5, weight: 1.5 },
  { pattern: /\bvery steamy\b/i, spice: 4.5, weight: 1.5 },
  { pattern: /\bopen.?door\b/i, spice: 4.0, weight: 2.0 },
  { pattern: /\bsteam(y|ing)\b/i, spice: 3.5, weight: 1.0 },
  { pattern: /\bhot (scenes?|chapters?)\b/i, spice: 3.5, weight: 1.0 },
  { pattern: /\bspicy\b/i, spice: 3.5, weight: 1.0 },
  { pattern: /\blove scenes?\b/i, spice: 3.0, weight: 0.8 },
  { pattern: /\bsex(ual)? (scenes?|content|tension)\b/i, spice: 3.0, weight: 1.0 },
  { pattern: new RegExp("\\b5.?\uD83C\uDF36\uFE0F|\uD83C\uDF36\uFE0F{4,5}", "i"), spice: 4.5, weight: 2.0 },
  { pattern: new RegExp("\\b4.?\uD83C\uDF36\uFE0F|\uD83C\uDF36\uFE0F{3,4}", "i"), spice: 3.5, weight: 2.0 },
  { pattern: new RegExp("\\b[23].?\uD83C\uDF36\uFE0F|\uD83C\uDF36\uFE0F{2,3}", "i"), spice: 2.5, weight: 1.5 },
  { pattern: new RegExp("\\b1.?\uD83C\uDF36\uFE0F|\uD83C\uDF36\uFE0F{1}", "i"), spice: 1.0, weight: 1.5 },

  // Strong low-spice indicators
  { pattern: /\bclosed.?door\b/i, spice: 0.5, weight: 2.0 },
  { pattern: /\bfade.?to.?black\b/i, spice: 1.0, weight: 2.0 },
  { pattern: /\bclean romance\b/i, spice: 0.5, weight: 2.0 },
  { pattern: /\bsweet romance\b/i, spice: 0.5, weight: 1.5 },
  { pattern: /\bno (spice|steam|sex)\b/i, spice: 0, weight: 2.0 },
  { pattern: /\bnot (spicy|steamy)\b/i, spice: 1.0, weight: 1.5 },
  { pattern: /\bwholesome\b/i, spice: 0.5, weight: 1.0 },
  { pattern: /\bchaste\b/i, spice: 0, weight: 1.5 },

  // Modifiers
  { pattern: /\btoo (much|many) (sex|spice|steam)\b/i, spice: 4.0, weight: 1.0 },
  { pattern: /\bnot enough (spice|steam|heat)\b/i, spice: 2.0, weight: 1.0 },
  { pattern: /\bmore spice\b/i, spice: 1.5, weight: 0.8 },
];

export interface KeywordClassifierResult {
  spice: number;
  confidence: number;
  keywordHits: string[];
  reviewsAnalyzed: number;
  perReviewScores: number[];
}

export interface ReviewClassifierResult {
  spice: number;
  confidence: number;
  method: "keyword" | "llm_fallback";
  keywordHits: string[];
  reviewsAnalyzed: number;
  perReviewScores: number[];
  reasoning?: string;
}

/**
 * Score a single review using keyword matching.
 * Returns { spice, hits } or null if no keywords matched.
 */
function scoreReview(review: string): { spice: number; hits: string[] } | null {
  let weightedSum = 0;
  let weightSum = 0;
  const hits: string[] = [];

  for (const kw of SPICE_KEYWORDS) {
    if (kw.pattern.test(review)) {
      weightedSum += kw.spice * kw.weight;
      weightSum += kw.weight;
      // Extract the matched text for logging
      const match = review.match(kw.pattern);
      if (match) hits.push(match[0]);
    }
  }

  if (hits.length === 0) return null;

  return {
    spice: weightedSum / weightSum,
    hits,
  };
}

/**
 * Classify spice from review text using keyword matching.
 * Returns null if fewer than 2 keyword hits across all reviews.
 */
export function classifyReviewsKeyword(
  reviews: string[]
): KeywordClassifierResult | null {
  if (!reviews || reviews.length === 0) return null;

  const perReviewScores: number[] = [];
  const allHits: string[] = [];
  let totalHits = 0;

  for (const review of reviews) {
    const result = scoreReview(review);
    if (result) {
      perReviewScores.push(Math.round(result.spice * 10) / 10);
      allHits.push(...result.hits);
      totalHits += result.hits.length;
    }
  }

  // Need at least 2 keyword hits for any confidence
  if (totalHits < 2) return null;

  // Weighted average of per-review scores
  const avgSpice =
    perReviewScores.reduce((a, b) => a + b, 0) / perReviewScores.length;

  // Compute standard deviation for confidence penalty
  const stdDev =
    perReviewScores.length > 1
      ? Math.sqrt(
          perReviewScores.reduce(
            (sum, s) => sum + Math.pow(s - avgSpice, 2),
            0
          ) / perReviewScores.length
        )
      : 0;

  // Confidence factors:
  // - More reviews with hits = higher confidence
  // - More total hits = higher confidence
  // - Lower std dev (agreement) = higher confidence
  const reviewCoverage = Math.min(perReviewScores.length / 5, 1); // max out at 5 reviews with hits
  const hitDensity = Math.min(totalHits / 8, 1); // max out at 8 hits
  const agreement = Math.max(0, 1 - stdDev / 2); // penalize high disagreement

  const confidence =
    Math.round(reviewCoverage * 0.3 * 100) / 100 +
    Math.round(hitDensity * 0.3 * 100) / 100 +
    Math.round(agreement * 0.4 * 100) / 100;

  const roundedSpice = Math.round(avgSpice * 2) / 2; // nearest 0.5

  return {
    spice: roundedSpice,
    confidence: Math.min(Math.round(confidence * 100) / 100, 1),
    keywordHits: allHits,
    reviewsAnalyzed: reviews.length,
    perReviewScores,
  };
}

/**
 * LLM fallback for when keyword scoring is inconclusive.
 * Sends review snippets to Claude Haiku for classification.
 */
async function classifyReviewsLlm(
  reviews: string[],
  title: string,
  author: string
): Promise<{ spice: number; confidence: number; reasoning: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });

  const reviewSnippets = reviews
    .slice(0, 5)
    .map((r, i) => `Review ${i + 1}: "${r.slice(0, 300)}"`)
    .join("\n");

  const prompt = `Here are reader reviews for "${title}" by ${author}. Based on how readers describe the content, estimate the spice/steam level on a 0-5 scale.

0 = No romance or completely closed door
1 = Sweet/clean romance (fade to black)
2 = Mild steam (tension, implied intimacy)
3 = Moderate steam (love scenes present but not highly detailed)
4 = Steamy/explicit (detailed love scenes)
5 = Very explicit/erotica

Reviews:
${reviewSnippets}

Respond with ONLY a JSON object, no other text:
{"spice": <number 0-5, can use 0.5 increments>, "confidence": <number 0-1>, "reasoning": "<one sentence>"}`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system:
        "You are a precise JSON-only responder. Output only valid JSON, no markdown formatting.",
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text
      .replace(/```json?\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    const spice = Number(parsed.spice);
    const confidence = Number(parsed.confidence);
    if (isNaN(spice) || spice < 0 || spice > 5) return null;
    if (isNaN(confidence) || confidence < 0 || confidence > 1) return null;

    return {
      spice: Math.round(spice * 2) / 2,
      confidence: Math.round(confidence * 100) / 100,
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch (err) {
    console.error(
      `[review-classifier] LLM fallback failed for "${title}":`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Full review classification pipeline: keyword first, LLM fallback if ambiguous.
 */
export async function classifyReviews(
  reviews: string[],
  title: string,
  author: string
): Promise<ReviewClassifierResult | null> {
  if (!reviews || reviews.length === 0) return null;

  // Phase A: Keyword scoring
  const keywordResult = classifyReviewsKeyword(reviews);

  if (keywordResult && keywordResult.confidence >= 0.3) {
    console.log(
      `[review-classifier] Keyword: "${title}" spice=${keywordResult.spice}, confidence=${keywordResult.confidence}, hits=${keywordResult.keywordHits.length}`
    );
    return {
      ...keywordResult,
      method: "keyword",
    };
  }

  // Phase B: LLM fallback for low-confidence or no keyword hits
  if (reviews.length >= 2) {
    // Check daily limit before calling LLM
    const dailyLimit = Number(process.env.REVIEW_CLASSIFIER_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;
    const usage = await getDailyReviewClassifierUsage();
    if (usage >= dailyLimit) {
      console.log(`[review-classifier] Daily limit reached (${usage}/${dailyLimit}), skipping LLM fallback for "${title}"`);
    } else {
      console.log(
        `[review-classifier] Keyword inconclusive for "${title}" (confidence=${keywordResult?.confidence ?? 0}), trying LLM fallback`
      );
      const llmResult = await classifyReviewsLlm(reviews, title, author);
      if (llmResult) {
        console.log(
          `[review-classifier] LLM fallback: "${title}" spice=${llmResult.spice}, confidence=${llmResult.confidence}`
        );
        return {
          spice: llmResult.spice,
          confidence: llmResult.confidence,
          method: "llm_fallback",
          keywordHits: keywordResult?.keywordHits ?? [],
          reviewsAnalyzed: reviews.length,
          perReviewScores: keywordResult?.perReviewScores ?? [],
          reasoning: llmResult.reasoning,
        };
      }
    }
  }

  // If keyword had some result but low confidence, still return it
  if (keywordResult) {
    return {
      ...keywordResult,
      method: "keyword",
    };
  }

  return null;
}
