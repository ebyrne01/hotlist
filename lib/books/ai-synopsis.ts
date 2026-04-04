import Anthropic from "@anthropic-ai/sdk";
import { saveSynopsis } from "./cache";
import { getAdminClient } from "@/lib/supabase/admin";

const SYNOPSIS_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_DAILY_LIMIT = 50;

/**
 * Check how many AI synopses have been generated today.
 * Counts books whose ai_synopsis was updated today (not enrichment_queue,
 * since ai_synopsis is now on-demand only).
 */
async function getDailySynopsisUsage(): Promise<number> {
  const supabase = getAdminClient();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("books")
    .select("*", { count: "exact", head: true })
    .not("ai_synopsis", "is", null)
    .gte("updated_at", todayStart.toISOString());

  if (error) {
    console.error("[ai-synopsis] Daily usage count failed, refusing to proceed:", error.message);
    return Infinity;
  }

  return count ?? 0;
}

const SYSTEM_PROMPT = `You write warm, engaging book synopses for romance readers. \
You are spoiler-free, tonal, and use the voice of an enthusiastic reader — not a librarian. \
Keep it to 3-4 sentences. \
Do not start the synopsis with the book title or author name — begin directly with the story.`;

/**
 * Strip leading markdown formatting characters from AI output.
 * Removes #, *, >, -, and similar at the start of the text.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/^[#*>\-–—]+\s*/gm, "") // leading #, *, >, -, — per line
    .replace(/\*\*(.*?)\*\*/g, "$1") // **bold**
    .replace(/\*(.*?)\*/g, "$1") // *italic*
    .replace(/^[""]|[""]$/g, "") // curly quotes wrapping entire text
    .replace(/^"|"$/g, "") // straight quotes wrapping entire text
    .trim();
}

/**
 * Detect when Haiku refuses to write a synopsis and apologizes instead.
 * These get published as the synopsis if not caught.
 */
function isApologySynopsis(text: string): boolean {
  const lower = text.toLowerCase();
  const REFUSAL_PATTERNS = [
    "falls outside my",
    "outside my wheelhouse",
    "not a romance novel",
    "isn't a romance novel",
    "isn't a romance book",
    "not a romance book",
    "i should let you know",
    "i need to let you know",
    "i should clarify",
    "i need to be honest",
    "this is a non-fiction",
    "this is a nonfiction",
    "this isn't a romance",
    "not a novel",
    "my specialty is writing synopses for romance",
    "my specialty is writing warm",
  ];
  return REFUSAL_PATTERNS.some((p) => lower.includes(p));
}

export async function generateSynopsis(book: {
  id: string;
  title: string;
  author: string;
  description: string | null;
  aiSynopsis: string | null;
  tropes?: string[];
}): Promise<string | null> {
  // Don't regenerate if we already have one
  if (book.aiSynopsis) return book.aiSynopsis;

  // Need at least a description to work with
  if (!book.description) return null;

  // Check daily limit
  const dailyLimit = Number(process.env.AI_SYNOPSIS_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;
  const usage = await getDailySynopsisUsage();
  if (usage >= dailyLimit) {
    console.log(`[ai-synopsis] Daily limit reached (${usage}/${dailyLimit}), skipping`);
    return null;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });

  const tropeList = book.tropes?.length
    ? `Tropes: ${book.tropes.join(", ")}`
    : "";

  const userPrompt = [
    `Title: ${book.title}`,
    `Author: ${book.author}`,
    `Description: ${book.description}`,
    tropeList,
    "",
    "Write a warm, spoiler-free synopsis for this book.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const message = await client.messages.create({
      model: SYNOPSIS_MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const raw =
      message.content[0].type === "text" ? message.content[0].text : null;

    const text = raw ? stripMarkdown(raw) : null;

    if (text && !isApologySynopsis(text)) {
      await saveSynopsis(book.id, text);
      return text;
    }

    if (text) {
      console.warn(`[ai-synopsis] Rejected apology synopsis for "${book.title}": "${text.slice(0, 80)}..."`);
    }

    return null;
  } catch (err) {
    console.error("AI synopsis generation failed:", err);
    return null;
  }
}
