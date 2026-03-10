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

const SYSTEM_PROMPT = `You are a book recommendation extractor for BookTok/BookStagram videos. Given a transcript, identify books the creator is RECOMMENDING, REVIEWING, or DISCUSSING as a main topic.

EXTRACT:
- Books the creator recommends, reviews, rates, or discusses at length
- Books in "books I read this month" or "book haul" style lists
- Books the creator says they loved, hated, or have opinions about

DO NOT EXTRACT:
- Books mentioned only as brief comparisons ("if you liked X", "similar to X", "giving X vibes")
- Planners, journals, workbooks, calendars, or non-book products
- Podcast names, movie/TV titles, or song names
- Anything that sounds like an ad, sponsor, or product placement
- Items with product numbers, model numbers, or prices (e.g., "(119) Elite Planner")
- Stationery, bookmarks, book accessories, or merchandise

For each book extract:
- title: The book title ONLY — do not include the author name in the title field
- author: Author name if mentioned (null if not mentioned). Extract separately from title.
- sentiment: "loved" | "liked" | "mixed" | "disliked" | "neutral"
- creatorQuote: A direct quote or close paraphrase of what the creator said about this book (max 2 sentences). Only include quotes about THIS specific book.
- confidence: "high" (creator clearly names and discusses this book) | "medium" (probably this book but title unclear) | "low" (brief mention, might be wrong)

Mark as "low" confidence if:
- The book is only mentioned as a comparison to another book
- The title is unclear or you're guessing based on context
- The mention is very brief (just a name drop with no opinion)

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

If no books are being recommended or discussed, return an empty array [].`;

/**
 * Post-extraction validation.
 * Catches obvious non-books that the model missed, and cleans up formatting.
 */
function validateAndClean(books: ExtractedBook[]): ExtractedBook[] {
  return books
    .map((book) => {
      // Clean title: remove leading numbers in parens, trim
      let title = book.title
        .replace(/^\(\d+\)\s*/, "")     // Remove "(119) " prefixes
        .replace(/^\d+\.\s*/, "")       // Remove "1. " numbering
        .replace(/\s*[-–—]\s*$/, "")    // Remove trailing dashes
        .trim();

      let author = book.author;

      // If title contains " - " or " by ", the author might be embedded
      const dashSplit = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
      if (dashSplit && !author) {
        title = dashSplit[1].trim();
        author = dashSplit[2].trim();
      }
      const bySplit = title.match(/^(.+?)\s+by\s+(.+)$/i);
      if (bySplit && !author) {
        title = bySplit[1].trim();
        author = bySplit[2].trim();
      }

      return { ...book, title, author };
    })
    .filter((book) => {
      const lower = book.title.toLowerCase();

      // Reject non-book items
      if (/\b(planner|journal|workbook|calendar|diary|notebook|bookmark|candle|merch)\b/i.test(book.title)) {
        return false;
      }

      // Reject items that are clearly not titles (too short, all numbers, etc.)
      if (book.title.length < 2) return false;
      if (/^\d+$/.test(book.title)) return false;

      // Reject if title looks like a product listing
      if (/^\(?\d+\)?\s/.test(book.title)) return false;

      // Reject common non-book media
      if (/\b(podcast|episode|season|movie|film|album|song|playlist)\b/i.test(lower)) {
        return false;
      }

      return true;
    });
}

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

    // Validate, clean, and filter out low-confidence results
    const validated = validateAndClean(parsed);
    return validated.filter((book) => book.confidence !== "low");
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
