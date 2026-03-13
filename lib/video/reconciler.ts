/**
 * BOOK RECONCILIATION — Cross-references vision and transcript signals.
 *
 * This is the intelligence layer that replaces the old naive title-similarity merge.
 * Given what Sonnet SAW on book covers and what Haiku HEARD in the transcript,
 * Sonnet produces the final, reconciled list of books.
 *
 * Key scenarios this handles:
 * - Creator describes a book without naming it → matched to cover seen in frames
 * - Creator names a book that was also shown → title confirmed, sentiment preserved
 * - Book shown on screen but never mentioned → included as vision-only
 * - Creator names a book but it was never shown → included as transcript-only
 *
 * Cost: ~$0.008-0.015 per call (text-only, moderate input/output).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedBook } from "./book-extractor";

/** Model for accuracy-critical tasks */
const MODEL_ACCURATE = "claude-sonnet-4-5-20250514";

const RECONCILIATION_SYSTEM_PROMPT = `You are a book identification expert for a BookTok video analysis tool. You will receive:

1. VISION BOOKS: Titles/authors read from book covers in video frames. These are the most reliable signal for exact book titles.
2. TRANSCRIPT BOOKS: Books mentioned in the audio. Some have exact titles (descriptionOnly: false), others are descriptions (descriptionOnly: true).

Your job: produce the FINAL reconciled list by cross-referencing these two signals.

RULES:
1. VISION TITLES ARE THE GROUND TRUTH for book identification. When vision reads a title from a cover, USE THAT EXACT TITLE even if you think it might be wrong. The downstream resolver will handle matching.
2. When a transcript description matches a vision book (same author or same topic), merge them: use the VISION title, carry over transcript's sentiment, quote, and author.
3. When vision and transcript both have the same book, use vision's title spelling.
4. SERIES NAMES from transcript (e.g., "the Brides of Karadoc series"): Keep the series name as the title with descriptionOnly: false — the downstream resolver handles series-to-book-1 mapping. Include the author if mentioned.
5. Vision-only books (shown but never discussed): include with sentiment "neutral".
6. Transcript-only books with exact titles: include as-is.
7. Transcript-only descriptions that don't match any vision book: include with descriptionOnly: true.
8. DO NOT change vision titles to different books. DO NOT guess at book titles that weren't in either list.
9. Deduplicate: each real book should appear exactly once.

For each book return:
- title: The book title (prefer vision title when available)
- author: Author name (prefer vision if available, fall back to transcript)
- sentiment: From transcript if available, otherwise "neutral"
- creatorQuote: From transcript if available, otherwise ""
- confidence: "high" if confirmed by both signals or vision clearly read, "medium" if only one signal
- descriptionOnly: false for real titles and series names, true only for vague descriptions

Return ONLY a JSON array. No preamble.`;

interface ReconciliationInput {
  visionBooks: ExtractedBook[];
  transcriptBooks: ExtractedBook[];
  transcript: string;
}

/**
 * Reconcile vision-detected books with transcript-extracted books.
 *
 * Uses Claude Sonnet to intelligently cross-reference what was SEEN
 * on book covers with what was SAID in the audio.
 *
 * Falls back to simple concatenation on failure — never throws.
 */
export async function reconcileBooks({
  visionBooks,
  transcriptBooks,
  transcript,
}: ReconciliationInput): Promise<ExtractedBook[]> {
  // If only one signal has data, no reconciliation needed
  if (visionBooks.length === 0 && transcriptBooks.length === 0) return [];
  if (visionBooks.length === 0) return transcriptBooks;
  if (transcriptBooks.length === 0) return visionBooks;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[reconciler] Missing ANTHROPIC_API_KEY");
    return fallbackMerge(visionBooks, transcriptBooks);
  }

  try {
    const client = new Anthropic({ apiKey });

    // Build the user message with both signals + transcript context
    const userMessage = `VISION BOOKS (read from book covers in video frames):
${JSON.stringify(visionBooks.map((b) => ({ title: b.title, author: b.author, confidence: b.confidence })), null, 2)}

TRANSCRIPT BOOKS (extracted from audio):
${JSON.stringify(transcriptBooks.map((b) => ({ title: b.title, author: b.author, descriptionOnly: b.descriptionOnly ?? false, sentiment: b.sentiment, creatorQuote: b.creatorQuote, confidence: b.confidence })), null, 2)}

FULL TRANSCRIPT (for context):
${transcript.slice(0, 2000)}

Produce the final reconciled book list.`;

    const response = await client.messages.create({
      model: MODEL_ACCURATE,
      max_tokens: 2048,
      system: RECONCILIATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text
      .replace(/^```json?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();

    const parsed: ExtractedBook[] = JSON.parse(cleaned);

    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.warn("[reconciler] Empty or invalid response, using fallback merge");
      return fallbackMerge(visionBooks, transcriptBooks);
    }

    // Normalize the output (ensure all fields are present)
    const reconciled = parsed.map((book) => ({
      title: book.title ?? "",
      author: book.author ?? null,
      sentiment: book.sentiment ?? ("neutral" as const),
      creatorQuote: book.creatorQuote ?? "",
      confidence: book.confidence ?? ("medium" as const),
      descriptionOnly: book.descriptionOnly ?? false,
    }));

    console.log(
      `[reconciler] Reconciled ${visionBooks.length} vision + ${transcriptBooks.length} transcript → ${reconciled.length} books`
    );

    return reconciled;
  } catch (err) {
    console.error("[reconciler] Failed, using fallback merge:", err);
    return fallbackMerge(visionBooks, transcriptBooks);
  }
}

/**
 * Simple fallback merge when reconciliation fails.
 * Prefers vision books, appends non-duplicate transcript books.
 */
function fallbackMerge(
  visionBooks: ExtractedBook[],
  transcriptBooks: ExtractedBook[]
): ExtractedBook[] {
  const merged = [...visionBooks];
  const visionTitles = new Set(
    visionBooks.map((b) => b.title.toLowerCase().trim())
  );

  for (const tBook of transcriptBooks) {
    const tNorm = tBook.title.toLowerCase().trim();
    // Skip if vision already has something very similar
    const isDuplicate = Array.from(visionTitles).some(
      (vTitle) => vTitle.includes(tNorm) || tNorm.includes(vTitle)
    );
    if (!isDuplicate) {
      merged.push(tBook);
    }
  }

  return merged;
}
