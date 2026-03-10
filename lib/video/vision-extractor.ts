/**
 * VISION-BASED BOOK EXTRACTION
 *
 * Extracts book titles from video frames using Claude Haiku's vision.
 * Most BookTok videos show book covers, "books I read this month" overlays,
 * or on-screen text listing titles. This catches books the creator
 * shows but doesn't say aloud.
 *
 * Approach (Option B — thumbnail-based, zero new dependencies):
 * 1. Use the video thumbnail URL from the RapidAPI downloader
 * 2. Send to Claude Haiku vision to read book covers and on-screen text
 * 3. Return as ExtractedBook[] to merge with transcript extraction
 *
 * Cost: ~$0.002-0.005 per call (one image + small output).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedBook } from "./book-extractor";

const VISION_SYSTEM_PROMPT = `You are a book title extractor. Look at these frames from a BookTok/BookStagram video and identify every book that is visible. Look for:
- Book covers being held up or displayed
- Title text on book covers or spines
- On-screen text overlays listing book titles (e.g., "books I read this month" lists)
- Title cards or captions showing book names
- Bookshelves where spines are readable

For each book you can identify, extract:
- title (as printed on the cover or screen)
- author (if visible on the cover, otherwise null)
- confidence: "high" (clearly readable) | "medium" (partially visible or likely) | "low" (guessing)

Return ONLY a JSON array. No preamble.
Example: [{"title": "Fourth Wing", "author": "Rebecca Yarros", "confidence": "high"}]
If no books are visible, return [].`;

interface VisionBook {
  title: string;
  author: string | null;
  confidence: "high" | "medium" | "low";
}

/**
 * Extract book titles from video frames/thumbnails using Claude Haiku vision.
 *
 * Accepts either image URLs (thumbnail URLs) or base64 Buffers.
 * Returns empty array on failure — never throws.
 */
export async function extractBooksFromFrames(
  images: (string | Buffer)[],
  creatorHandle?: string
): Promise<ExtractedBook[]> {
  if (images.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[vision-extractor] Missing ANTHROPIC_API_KEY");
    return [];
  }

  try {
    const client = new Anthropic({ apiKey });

    // Build image content blocks
    const imageBlocks: Anthropic.Messages.ContentBlockParam[] = images
      .map((img): Anthropic.Messages.ContentBlockParam | null => {
        if (typeof img === "string") {
          // URL-based image (thumbnail)
          return {
            type: "image",
            source: { type: "url", url: img },
          };
        } else if (Buffer.isBuffer(img)) {
          // Base64-encoded buffer
          return {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: img.toString("base64"),
            },
          };
        }
        return null;
      })
      .filter((block): block is Anthropic.Messages.ContentBlockParam => block !== null);

    if (imageBlocks.length === 0) return [];

    // Add text prompt after images
    const userContent: Anthropic.Messages.ContentBlockParam[] = [
      ...imageBlocks,
      {
        type: "text",
        text: creatorHandle
          ? `These are frames from a BookTok video by ${creatorHandle}. What books can you see?`
          : "These are frames from a BookTok video. What books can you see?",
      },
    ];

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: VISION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text
      .replace(/^```json?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();

    const parsed: VisionBook[] = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) {
      console.error("[vision-extractor] Response is not an array:", text);
      return [];
    }

    // Filter out low-confidence and map to ExtractedBook format
    return parsed
      .filter((book) => book.confidence !== "low" && book.title)
      .map((book) => ({
        title: book.title,
        author: book.author ?? null,
        sentiment: "neutral" as const,
        creatorQuote: "",
        confidence: book.confidence,
      }));
  } catch (err) {
    console.error("[vision-extractor] Failed:", err);
    return [];
  }
}

/**
 * Merge transcript-extracted and vision-extracted books.
 *
 * Deduplicates by normalized title similarity.
 * When the same book appears in both:
 * - Prefer transcript version's sentiment and quote
 * - Prefer vision version's title spelling (read from text, not speech-to-text)
 * - Use the higher confidence of the two
 *
 * Vision-only books are appended at the end.
 */
export function mergeExtractedBooks(
  fromTranscript: ExtractedBook[],
  fromVision: ExtractedBook[]
): ExtractedBook[] {
  if (fromVision.length === 0) return fromTranscript;
  if (fromTranscript.length === 0) return fromVision;

  const merged = [...fromTranscript];
  const usedTranscriptIndices = new Set<number>();

  for (const visionBook of fromVision) {
    const vNorm = normalize(visionBook.title);

    // Find matching transcript book
    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < fromTranscript.length; i++) {
      if (usedTranscriptIndices.has(i)) continue;
      const tNorm = normalize(fromTranscript[i].title);
      const score = titleSimilarity(vNorm, tNorm);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestScore >= 0.6 && bestIdx >= 0) {
      // Match found — merge: vision title, transcript sentiment/quote, higher confidence
      usedTranscriptIndices.add(bestIdx);
      const transcript = fromTranscript[bestIdx];
      merged[bestIdx] = {
        ...transcript,
        // Prefer vision's title spelling (read from text, not STT)
        title: visionBook.title,
        // Prefer vision's author if transcript has none
        author: transcript.author ?? visionBook.author,
        // Use higher confidence
        confidence: higherConfidence(transcript.confidence, visionBook.confidence),
      };
    } else {
      // Vision-only book — append
      merged.push(visionBook);
    }
  }

  return merged;
}

// ── Helpers ──

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^\w\s']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Simple word-overlap similarity between two normalized titles. */
function titleSimilarity(a: string, b: string): number {
  const wordsA = a.split(" ").filter((w) => w.length > 1);
  const wordsB = new Set(b.split(" ").filter((w) => w.length > 1));
  if (wordsA.length === 0 || wordsB.size === 0) return 0;
  const matches = wordsA.filter((w) => wordsB.has(w)).length;
  return matches / Math.max(wordsA.length, wordsB.size);
}

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

function higherConfidence(
  a: "high" | "medium" | "low",
  b: "high" | "medium" | "low"
): "high" | "medium" | "low" {
  return (CONFIDENCE_RANK[a] ?? 0) >= (CONFIDENCE_RANK[b] ?? 0) ? a : b;
}
