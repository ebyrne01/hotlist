import Anthropic from "@anthropic-ai/sdk";
import { saveSynopsis } from "./cache";

const SYNOPSIS_MODEL = "claude-haiku-4-5-20251001";

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

    if (text) {
      await saveSynopsis(book.id, text);
    }

    return text;
  } catch (err) {
    console.error("AI synopsis generation failed:", err);
    return null;
  }
}
