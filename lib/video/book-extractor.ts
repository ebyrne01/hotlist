/**
 * Book Extraction from video transcripts using Claude Haiku.
 *
 * Takes a transcript and extracts structured book recommendations
 * from natural speech.
 */

import Anthropic from "@anthropic-ai/sdk";

export interface ExtractedBook {
  title: string;
  author: string | null;
  sentiment: "loved" | "liked" | "mixed" | "disliked" | "neutral";
  creatorQuote: string;
  confidence: "high" | "medium" | "low";
}

const SYSTEM_PROMPT = `You are a book recommendation extractor. Given a transcript from a BookTok or BookStagram video, identify every book that is mentioned, recommended, reviewed, or discussed. For each book extract:
- title (as clearly as you can determine from context)
- author (if mentioned)
- the creator's sentiment: "loved" | "liked" | "mixed" | "disliked" | "neutral"
- a direct quote or close paraphrase of what the creator said about this book (max 2 sentences)
- confidence: "high" (clearly named) | "medium" (probably this book) | "low" (might be this book)

Return ONLY a JSON array. No preamble, no explanation.
Example:
[
  {
    "title": "A Court of Thorns and Roses",
    "author": "Sarah J. Maas",
    "sentiment": "loved",
    "creatorQuote": "This is the book that got me into romantasy, I have reread it four times.",
    "confidence": "high"
  }
]

If no books are mentioned, return an empty array [].
Do not include movies, TV shows, or non-book media.`;

/**
 * Extract book mentions from a transcript using Claude Haiku.
 * Filters out low-confidence results.
 * Returns empty array on failure — never throws.
 */
export async function extractBooksFromTranscript(
  transcript: string,
  creatorHandle?: string
): Promise<ExtractedBook[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[book-extractor] Missing ANTHROPIC_API_KEY");
    return [];
  }

  try {
    const client = new Anthropic({ apiKey });

    const userMessage = creatorHandle
      ? `Video by ${creatorHandle}:\n\n${transcript}`
      : transcript;

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    // Extract text from response
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Parse JSON — Claude sometimes wraps in markdown code blocks
    const cleaned = text
      .replace(/^```json?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();

    const parsed: ExtractedBook[] = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) {
      console.error("[book-extractor] Response is not an array:", text);
      return [];
    }

    // Filter out low-confidence results
    return parsed.filter((book) => book.confidence !== "low");
  } catch (err) {
    console.error("[book-extractor] Failed:", err);
    return [];
  }
}
