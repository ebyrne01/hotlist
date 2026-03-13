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

const RECONCILIATION_SYSTEM_PROMPT = `You are a book identification expert. You will receive two lists of books detected from a BookTok video:

1. VISION BOOKS: Titles and authors read directly from book covers shown in video frames. Vision can misread covers — titles may be from the wrong book in a series (e.g., reading Book 5's cover when the creator is discussing Book 1).
2. TRANSCRIPT BOOKS: Books mentioned in the audio transcript. Some have exact titles (descriptionOnly: false), others have descriptions instead of titles (descriptionOnly: true) because the creator described the book without naming it.

Your job is to produce the FINAL, reconciled list of books by cross-referencing these two signals.

RULES:
1. SERIES AWARENESS IS CRITICAL: When the transcript says "starting book", "first in the series", "where you first meet [character]", or implies Book 1, but the vision shows a different book in the same series, USE BOOK 1's TITLE — not the vision title. The creator is recommending the entry point, not whichever book happened to be face-up.
2. When a transcript description matches a vision-detected book and there's no series conflict, use the vision title. Carry over the transcript's sentiment, quote, and author.
3. SERIES NAMES ARE NOT TITLES: If the transcript mentions a series name (e.g., "the Monsters of Faerie series" or "the Brides of Karadoc series"), you MUST resolve it to a specific book title. Use context clues: if the creator recommends the series as a whole, use Book 1. If they mention a specific book, use that title. Use your knowledge of book series to identify the correct title and author. NEVER output a series name as a title — always output the specific book.
4. Vision-only books (shown but never discussed): include them with sentiment "neutral".
5. Transcript-only books with exact titles (not shown on screen): include them as-is.
6. Transcript-only descriptions that don't match any vision book: include them but mark as descriptionOnly.
7. USE YOUR BOOK KNOWLEDGE: You know romance, romantasy, and fantasy series. When the transcript or vision gives you a series name, an incorrect book in a series, or a description, use your knowledge to identify the SPECIFIC correct book title and author. For example, if vision reads "Ancient Vengeance" but the transcript describes "a dystopian future where evil dragons have taken over" and talks about the series as a whole, the correct entry point is likely the FIRST book in that series — use your knowledge to name it.
8. DO NOT invent books that appear in neither list. But DO correct series misidentifications using your knowledge.
9. Deduplicate: each real book should appear exactly once.

For each book in the final list, return:
- title: The CORRECT book title — use your knowledge of book series to pick the right entry when transcript context and vision disagree
- author: Author name (prefer vision if available, fall back to transcript)
- sentiment: From transcript if available, otherwise "neutral"
- creatorQuote: From transcript if available, otherwise ""
- confidence: "high" if confirmed by both vision + transcript, "high" if vision clearly read it, "medium" if only one signal
- descriptionOnly: false if we have a real title (including ones you identified from series context), true if still just a description

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
