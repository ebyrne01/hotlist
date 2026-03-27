/**
 * AI-generated "Booktrack" prompt for Spotify AI Playlist.
 * Uses Claude Haiku to generate a mood-evocative prompt from book metadata.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAdminClient } from "@/lib/supabase/admin";

const BOOKTRACK_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_DAILY_LIMIT = 50;

interface ReadingVibesInput {
  title: string;
  author: string;
  tropes: string[];
  spiceLevel: number | null;
  synopsis: string | null;
  genres: string[];
}

interface ReadingVibesResult {
  prompt: string;
  moodTags: string[];
}

/**
 * Check how many booktrack prompts have been successfully generated today.
 * Counts actual prompts stored in books table (via updated_at), not queue
 * job completions, to avoid inflating the count with retries and re-runs.
 */
async function getDailyBooktrackUsage(): Promise<number> {
  const supabase = getAdminClient();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("books")
    .select("*", { count: "exact", head: true })
    .not("booktrack_prompt", "is", null)
    .gte("updated_at", todayStart.toISOString());

  return count ?? 0;
}

/**
 * Generate a Spotify AI Playlist prompt that captures the mood of a book.
 * Uses Claude Haiku for speed and cost (~$0.001 per call).
 */
export async function generateReadingVibes(
  input: ReadingVibesInput
): Promise<ReadingVibesResult | null> {
  // Check daily limit
  const dailyLimit = Number(process.env.BOOKTRACK_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;
  const usage = await getDailyBooktrackUsage();
  if (usage >= dailyLimit) {
    console.log(`[booktrack] Daily limit reached (${usage}/${dailyLimit}), skipping`);
    return null;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });

  const spiceContext = input.spiceLevel
    ? `Spice/heat level: ${input.spiceLevel}/5 (${
        input.spiceLevel <= 1 ? "sweet/clean" :
        input.spiceLevel <= 2 ? "mild, closed-door" :
        input.spiceLevel <= 3 ? "steamy, moderate heat" :
        input.spiceLevel <= 4 ? "spicy, explicit" :
        "scorching, very explicit"
      })`
    : "Spice level unknown";

  try {
    const response = await client.messages.create({
      model: BOOKTRACK_MODEL,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `Generate a Spotify Prompted Playlist prompt for someone reading this book. The prompt should evoke the book's EMOTIONAL MOOD and ATMOSPHERE — not describe the plot.

Book: "${input.title}" by ${input.author}
Tropes: ${input.tropes.join(", ") || "none tagged"}
Genres: ${input.genres.join(", ") || "romance"}
${spiceContext}
${input.synopsis ? `Synopsis: ${input.synopsis.slice(0, 500)}` : ""}

Rules:
- The prompt MUST start with: "Create a playlist called ${input.title}."
- After that opening line, write under 50 words that Spotify's Prompted Playlists feature would understand
- Reference real musical artists, genres, or moods that match the book's vibe
- Match the energy to the spice level (sweet = soft/acoustic, scorching = intense/sensual)
- Match the setting (fae/fantasy = ethereal/orchestral, contemporary = pop/indie/R&B, dark = industrial/gothic)
- Do NOT mention the author or character names in the rest of the prompt (the title is already in the opening line)
- Make it evocative — a reader should think "yes, that's exactly the vibe"

Also provide 3-5 single-word mood tags (e.g. "yearning", "dark", "ethereal", "passionate", "cozy").

Respond in this exact format:
PROMPT: [your prompt here]
MOODS: [comma-separated mood tags]`,
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    const promptMatch = text.match(/PROMPT:\s*([\s\S]+?)(?:\n|MOODS:)/);
    const moodMatch = text.match(/MOODS:\s*(.+)/);

    if (!promptMatch) return null;

    return {
      prompt: promptMatch[1].trim().replace(/^["']|["']$/g, ""),
      moodTags: moodMatch
        ? moodMatch[1].split(",").map((m) => m.trim().toLowerCase()).filter(Boolean)
        : [],
    };
  } catch (err) {
    console.warn("[booktrack] Generation failed:", err);
    return null;
  }
}
