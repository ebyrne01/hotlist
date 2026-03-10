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

/**
 * TITLE CORRECTION PASS
 *
 * Uses Claude Haiku to fix likely Whisper transcription errors.
 * Whisper is bad at: fantasy proper nouns, unusual author names,
 * non-English words, and words that sound like common English words.
 *
 * Cost: ~$0.001 per call (tiny input, tiny output).
 * On failure, returns the original array unchanged (graceful degradation).
 */
export async function correctExtractedBooks(
  books: ExtractedBook[]
): Promise<ExtractedBook[]> {
  if (books.length === 0) return books;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return books;

  try {
    const client = new Anthropic({ apiKey });

    // Only send title + author to minimize tokens
    const input = books.map((b) => ({
      title: b.title,
      author: b.author ?? "Unknown",
    }));

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: `You are a book title and author name corrector. You receive a list of book titles and authors extracted from speech-to-text transcription of BookTok/BookStagram videos. Speech-to-text often garbles:
- Fantasy/unusual proper nouns (e.g., "Alchemized" should be "Alchemised", "Manicold" should be "Manacled")
- Author names, especially non-Western or unusual ones (e.g., "Cinlan Yu" should be "SenLinYu")
- Series names and subtitles
- Words that sound like common English but are actually fantasy terms

For each book, return the corrected title and author. If you're not confident in a correction, return the original unchanged. Only correct clear transcription errors — do not guess at books you don't recognize.

Return ONLY a JSON array with the same structure as the input. No preamble.`,
      messages: [{ role: "user", content: JSON.stringify(input) }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text
      .replace(/^```json?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();

    const corrected: { title: string; author: string }[] = JSON.parse(cleaned);

    if (!Array.isArray(corrected) || corrected.length !== books.length) {
      console.warn("[book-extractor] Correction returned wrong array length, using originals");
      return books;
    }

    // Merge corrections back — only update title/author, keep everything else
    return books.map((original, i) => ({
      ...original,
      title: corrected[i].title || original.title,
      author: corrected[i].author === "Unknown" ? original.author : (corrected[i].author || original.author),
    }));
  } catch (err) {
    console.error("[book-extractor] Title correction failed, using originals:", err);
    return books;
  }
}
