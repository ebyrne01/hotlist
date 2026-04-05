/**
 * READING DNA — AI Blurb Generator
 *
 * Generates a warm, personalized 2-3 sentence description of a reader's
 * DNA profile using Claude Haiku. Called once after quiz completion.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAdminClient } from "@/lib/supabase/admin";

const MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_DAILY_LIMIT = 50;

const SYSTEM_PROMPT = `You write fun, warm, 2-3 sentence reading personality descriptions for romance and romantasy readers. \
You're speaking directly to the reader ("You're the kind of reader who..."). \
Be specific to their tropes and spice level. Use a slightly spicy, enthusiastic tone — never corporate or generic. \
Do not use bullet points, headers, or emoji. Just flowing prose.`;

const SPICE_LABELS: Record<number, string> = {
  1: "sweet (closed door)",
  2: "mild (fade to black)",
  3: "medium (steamy but not explicit)",
  4: "hot (explicit scenes)",
  5: "scorching (erotica-level heat)",
};

/**
 * Generate a personalized DNA blurb from trope affinities and spice level.
 */
export async function generateDnaBlurb(input: {
  topTropes: { name: string; score: number }[];
  spicePreferred: number;
  spiceLevels?: number[];
  bookTitles: string[];
  subgenres?: string[];
}): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  // Daily limit check
  const supabase = getAdminClient();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("reading_dna")
    .select("*", { count: "exact", head: true })
    .gte("updated_at", todayStart.toISOString());
  const dailyLimit = Number(process.env.READING_DNA_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;
  if ((count ?? 0) >= dailyLimit) {
    console.log(`[generate-blurb] Daily limit reached (${count}/${dailyLimit}), skipping`);
    return null;
  }

  const client = new Anthropic({ apiKey });

  // Build spice description from selected levels (or fall back to preferred)
  const selectedLevels = input.spiceLevels && input.spiceLevels.length > 0
    ? [...input.spiceLevels].sort((a, b) => a - b)
    : [Math.round(input.spicePreferred)];
  const spiceLabel = selectedLevels.length === 1
    ? SPICE_LABELS[selectedLevels[0]] ?? "medium"
    : selectedLevels.map((l) => SPICE_LABELS[l] ?? String(l)).join(" to ");

  const tropeList = input.topTropes
    .map((t) => `${t.name} (${Math.round(t.score * 100)}%)`)
    .join(", ");

  const bookList = input.bookTitles.join(", ");

  const subgenreLine =
    input.subgenres && input.subgenres.length > 0
      ? `Preferred subgenres: ${input.subgenres.join(", ")}`
      : null;

  const userPrompt = [
    ...(subgenreLine ? [subgenreLine] : []),
    `This reader's top trope affinities: ${tropeList}`,
    `Spice preference: ${spiceLabel}`,
    `Books they loved: ${bookList}`,
    "",
    "Write a 2-3 sentence reading personality description for this reader.",
  ].join("\n");

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const raw =
      message.content[0].type === "text" ? message.content[0].text : null;

    if (!raw) return null;

    // Strip any markdown formatting
    return raw
      .replace(/^[#*>\-–—]+\s*/gm, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[generate-blurb] Failed to generate DNA blurb: ${msg}`);
    return null;
  }
}
