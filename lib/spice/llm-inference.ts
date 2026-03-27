/**
 * LLM SPICE INFERENCE — Claude-based spice estimation from book descriptions
 *
 * Uses Claude Haiku to estimate spice level from a book's description and genres.
 * This is a low-confidence signal (weight 0.4 in composite scoring) but more
 * nuanced than genre bucketing — it can detect specific language cues.
 *
 * Cost: ~$0.001 per inference with Haiku.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAdminClient } from "@/lib/supabase/admin";

const MODEL = "claude-haiku-4-5-20251001";
const MIN_DESCRIPTION_LENGTH = 50;
const DEFAULT_DAILY_LIMIT = 25;

/** Sources that outrank LLM inference — skip if any of these exist */
const HIGHER_CONFIDENCE_SOURCES = ["community", "romance_io", "review_classifier"];

export interface LlmSpiceResult {
  spice: number;
  confidence: number;
  reasoning: string;
}

/**
 * Check how many LLM inferences have been run today.
 * Uses a simple row in spice_signals with today's date range.
 */
async function getDailyUsage(): Promise<number> {
  const supabase = getAdminClient();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("spice_signals")
    .select("*", { count: "exact", head: true })
    .eq("source", "llm_inference")
    .gte("updated_at", todayStart.toISOString());

  return count ?? 0;
}

/**
 * Check if a book already has a higher-confidence spice signal.
 */
export async function hasHigherConfidenceSignal(bookId: string): Promise<boolean> {
  const supabase = getAdminClient();

  const { data } = await supabase
    .from("spice_signals")
    .select("source")
    .eq("book_id", bookId)
    .in("source", HIGHER_CONFIDENCE_SOURCES)
    .limit(1);

  return (data?.length ?? 0) > 0;
}

/**
 * Infer spice level from a book's description using Claude Haiku.
 * Returns null if the API key is missing, description is too short, or parsing fails.
 */
export async function inferSpiceFromDescription(book: {
  title: string;
  author: string;
  description: string;
  genres: string[];
}): Promise<LlmSpiceResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[llm-spice] ANTHROPIC_API_KEY not set, skipping inference");
    return null;
  }

  if (!book.description || book.description.length < MIN_DESCRIPTION_LENGTH) {
    return null;
  }

  const client = new Anthropic({ apiKey });

  const prompt = `You are a romance book spice level classifier. Based on the book's description and genre tags, estimate how explicit the sexual content is on a 0-5 scale:

0 = No romance or completely closed door (no physical intimacy beyond a kiss)
1 = Sweet/clean romance (kissing, hand-holding, fade to black before anything explicit)
2 = Mild steam (some physical tension, making out, implied intimacy but not described)
3 = Moderate steam (love scenes present but not highly detailed, tasteful descriptions)
4 = Steamy/explicit (detailed love scenes, frequent intimate content)
5 = Very explicit/erotica (graphic, frequent, and central to the plot)

Book: "${book.title}" by ${book.author}
Genres: ${book.genres.length > 0 ? book.genres.join(", ") : "unknown"}
Description: ${book.description}

Respond with ONLY a JSON object, no other text:
{"spice": <number 0-5, can use 0.5 increments>, "confidence": <number 0-1 reflecting how sure you are>, "reasoning": "<one sentence explanation>"}`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: "You are a precise JSON-only responder. Output only valid JSON, no markdown formatting.",
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Clean potential markdown code blocks
    const cleaned = text.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    // Validate ranges
    const spice = Number(parsed.spice);
    const confidence = Number(parsed.confidence);
    const reasoning = String(parsed.reasoning ?? "");

    if (isNaN(spice) || spice < 0 || spice > 5) return null;
    if (isNaN(confidence) || confidence < 0 || confidence > 1) return null;

    // Round spice to nearest 0.5
    const roundedSpice = Math.round(spice * 2) / 2;

    console.log(
      `[llm-spice] "${book.title}": spice=${roundedSpice}, confidence=${confidence}, reason="${reasoning}"`
    );

    return {
      spice: roundedSpice,
      confidence: Math.round(confidence * 100) / 100,
      reasoning,
    };
  } catch (err) {
    console.error(
      `[llm-spice] Inference failed for "${book.title}":`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Run LLM spice inference for a book and upsert into spice_signals.
 * Respects daily limit and skips books with higher-confidence signals.
 * Returns true if inference was performed, false if skipped.
 */
export async function inferAndUpsertSpice(
  bookId: string,
  book: { title: string; author: string; description: string; genres: string[] }
): Promise<boolean> {
  // Skip if description is too short
  if (!book.description || book.description.length < MIN_DESCRIPTION_LENGTH) {
    return false;
  }

  // Skip if higher-confidence signal exists
  if (await hasHigherConfidenceSignal(bookId)) {
    return false;
  }

  // Check daily limit
  const dailyLimit = Number(process.env.SPICE_LLM_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;
  const usage = await getDailyUsage();
  if (usage >= dailyLimit) {
    console.log(`[llm-spice] Daily limit reached (${usage}/${dailyLimit}), skipping`);
    return false;
  }

  const result = await inferSpiceFromDescription(book);
  if (!result) return false;

  const supabase = getAdminClient();

  await supabase.from("spice_signals").upsert(
    {
      book_id: bookId,
      source: "llm_inference",
      spice_value: result.spice,
      confidence: result.confidence,
      evidence: {
        reasoning: result.reasoning,
        model: MODEL,
        description_length: book.description.length,
        inferred_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "book_id,source" }
  );

  return true;
}
