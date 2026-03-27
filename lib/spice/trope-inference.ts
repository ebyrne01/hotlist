/**
 * TROPE INFERENCE — Claude-based trope tagging from book descriptions
 *
 * Uses Claude Haiku to identify which of the 25 canonical tropes apply to a book
 * based on its description and genres. Inserts results into book_tropes.
 *
 * Cost: ~$0.001 per inference with Haiku.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAdminClient } from "@/lib/supabase/admin";

const MODEL = "claude-haiku-4-5-20251001";
const MIN_DESCRIPTION_LENGTH = 50;
const DEFAULT_DAILY_LIMIT = 50;

/**
 * Check how many trope inferences have been run today.
 */
async function getDailyTropeUsage(): Promise<number> {
  const supabase = getAdminClient();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("enrichment_queue")
    .select("*", { count: "exact", head: true })
    .eq("job_type", "trope_inference")
    .eq("status", "complete")
    .gte("completed_at", todayStart.toISOString());

  return count ?? 0;
}

/**
 * Canonical trope slugs — must match the `tropes` table exactly.
 * Hardcoded here to avoid a DB round-trip on every inference.
 */
const CANONICAL_TROPES = [
  "age-gap",
  "arranged-marriage",
  "billionaire",
  "bodyguard-romance",
  "chosen-one",
  "dark-romance",
  "enemies-to-lovers",
  "fae-faerie",
  "fake-dating",
  "forbidden-romance",
  "forced-proximity",
  "friends-to-lovers",
  "grumpy-sunshine",
  "holiday-romance",
  "instalove",
  "love-triangle",
  "mafia-romance",
  "office-romance",
  "reverse-harem",
  "second-chance",
  "shifter",
  "slow-burn",
  "small-town",
  "sports-romance",
  "vampire",
] as const;

export interface TropeInferenceResult {
  tropes: string[];
  reasoning: string;
}

/**
 * Infer tropes from a book's description using Claude Haiku.
 * Returns matching trope slugs from the canonical list.
 */
export async function inferTropesFromDescription(book: {
  title: string;
  author: string;
  description: string;
  genres: string[];
}): Promise<TropeInferenceResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[trope-inference] ANTHROPIC_API_KEY not set, skipping");
    return null;
  }

  if (!book.description || book.description.length < MIN_DESCRIPTION_LENGTH) {
    return null;
  }

  const client = new Anthropic({ apiKey });

  const tropeList = CANONICAL_TROPES.map((slug) =>
    slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  ).join(", ");

  const prompt = `You are a romance/romantasy book trope classifier. Based on the book's description and genre tags, identify which tropes apply.

Available tropes (pick ONLY from this list):
${tropeList}

Book: "${book.title}" by ${book.author}
Genres: ${book.genres.length > 0 ? book.genres.join(", ") : "unknown"}
Description: ${book.description}

Rules:
- Only select tropes you are reasonably confident apply based on the description
- Most books have 1-4 tropes. Some may have none from this list.
- Do NOT guess tropes that aren't supported by the description
- Return trope names exactly as listed above

Respond with ONLY a JSON object, no other text:
{"tropes": ["Trope Name 1", "Trope Name 2"], "reasoning": "<one sentence explaining your choices>"}

If no tropes from the list clearly apply, return: {"tropes": [], "reasoning": "No clear trope matches from description"}`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
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

    if (!Array.isArray(parsed.tropes)) return null;

    // Map display names back to slugs
    const validSlugs: string[] = [];
    for (const tropeName of parsed.tropes) {
      const slug = String(tropeName)
        .toLowerCase()
        .replace(/\s*\/\s*/g, "-")
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      if (CANONICAL_TROPES.includes(slug as (typeof CANONICAL_TROPES)[number])) {
        validSlugs.push(slug);
      }
    }

    console.log(
      `[trope-inference] "${book.title}": ${validSlugs.length} tropes — ${validSlugs.join(", ") || "none"}`
    );

    return {
      tropes: validSlugs,
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch (err) {
    console.error(
      `[trope-inference] Failed for "${book.title}":`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Run trope inference for a book and upsert results into book_tropes.
 * Skips books that already have tropes from a higher-confidence source.
 * Returns true if tropes were inferred and saved.
 */
export async function inferAndUpsertTropes(
  bookId: string,
  book: {
    title: string;
    author: string;
    description: string;
    genres: string[];
  }
): Promise<boolean> {
  if (!book.description || book.description.length < MIN_DESCRIPTION_LENGTH) {
    return false;
  }

  // Check daily limit
  const dailyLimit = Number(process.env.TROPE_INFERENCE_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;
  const usage = await getDailyTropeUsage();
  if (usage >= dailyLimit) {
    console.log(`[trope-inference] Daily limit reached (${usage}/${dailyLimit}), skipping`);
    return false;
  }

  const supabase = getAdminClient();

  // Skip if book already has tropes from scraping (higher confidence)
  const { data: existingTropes } = await supabase
    .from("book_tropes")
    .select("trope_id")
    .eq("book_id", bookId)
    .in("source", ["goodreads", "scraping"])
    .limit(1);

  if (existingTropes && existingTropes.length > 0) {
    return false;
  }

  const result = await inferTropesFromDescription(book);
  if (!result || result.tropes.length === 0) return false;

  // Look up trope IDs from slugs
  const { data: tropeRows } = await supabase
    .from("tropes")
    .select("id, slug")
    .in("slug", result.tropes);

  if (!tropeRows || tropeRows.length === 0) return false;

  // Delete existing LLM-inferred tropes for this book (replace, not accumulate)
  await supabase
    .from("book_tropes")
    .delete()
    .eq("book_id", bookId)
    .eq("source", "llm_inference");

  // Insert new tropes
  const rows = tropeRows.map((t) => ({
    book_id: bookId,
    trope_id: t.id,
    source: "llm_inference",
  }));

  const { error } = await supabase.from("book_tropes").upsert(rows, {
    onConflict: "book_id,trope_id",
  });

  if (error) {
    console.error(`[trope-inference] DB error for "${book.title}":`, error);
    return false;
  }

  return true;
}
