/**
 * VISION-BASED BOOK EXTRACTION
 *
 * Extracts book titles from video frames using Claude Sonnet's vision.
 * Most BookTok videos show book covers, "books I read this month" overlays,
 * or on-screen text listing titles. This catches books the creator
 * shows but doesn't say aloud.
 *
 * Uses Sonnet (not Haiku) for better OCR and cover reading accuracy.
 *
 * Approach: Multi-frame analysis
 * 1. Extract frames from the video at regular intervals (via frame-extractor)
 * 2. Fall back to thumbnail if frame extraction fails
 * 3. Send all frames to Claude Sonnet vision to read book covers
 * 4. Return as ExtractedBook[] for reconciliation with transcript extraction
 *
 * Cost: ~$0.04-0.08 per call (10-20 frames + output).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedBook } from "./book-extractor";

/** Model for accuracy-critical tasks (title correction, vision) */
const MODEL_ACCURATE = "claude-sonnet-4-5-20250514";

const VISION_SYSTEM_PROMPT = `You are a book cover OCR specialist for a BookTok video analysis tool. You will receive sequential frames from a short video (typically 15-60 seconds). Your job is to read the EXACT title and author from every book cover shown.

HOW TO READ BOOK COVERS:
1. Look for the LARGEST text on the cover — this is usually the title
2. Look for smaller text above or below the title — this is usually the author
3. Some covers have the author name ABOVE the title in smaller font
4. Read EVERY WORD of the title exactly as printed — do not paraphrase or abbreviate
5. If a book appears in multiple frames, use the CLEAREST frame to read the title

WHAT TO LOOK FOR:
- Book covers being held up, displayed, or shown to the camera
- Book spines with readable text
- On-screen text overlays listing book titles
- Title cards, captions, or text graphics showing book names

CRITICAL ACCURACY RULES:
- Read the EXACT text printed on each cover. Character-by-character accuracy matters.
- Do NOT substitute a different book title even if you think you recognize the author or series.
- If the cover says "Captured by the Fae Beast", report exactly that — not a different book by the same author.
- If the cover says "Ancient Protector", report exactly that — not "Ancient Vengeance" or another book in the series.
- If you cannot read the full title clearly, report what you CAN read and set confidence to "medium" or "low".
- The same book may appear in multiple consecutive frames — deduplicate. Only list each book ONCE.

For each book, extract:
- title: The EXACT title as printed on the cover (character-by-character, not a guess)
- author: The EXACT author name as printed (null if not readable)
- confidence: "high" (title and author clearly readable) | "medium" (title readable, author unclear) | "low" (partially visible, uncertain)

Return ONLY a JSON array. No preamble.
Example: [{"title": "Fourth Wing", "author": "Rebecca Yarros", "confidence": "high"}]
If no books are visible, return [].`;

interface VisionBook {
  title: string;
  author: string | null;
  confidence: "high" | "medium" | "low";
}

/**
 * Extract book titles from video frames/thumbnails using Claude Sonnet vision.
 *
 * Accepts either image URLs (thumbnail URLs) or base64 Buffers (extracted frames).
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
          // Base64-encoded buffer (extracted frame)
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
    const frameCount = imageBlocks.length;
    const userContent: Anthropic.Messages.ContentBlockParam[] = [
      ...imageBlocks,
      {
        type: "text",
        text: creatorHandle
          ? `These are ${frameCount} sequential frames from a BookTok video by ${creatorHandle}. Identify every distinct book shown across all frames. Read titles and authors directly from what's visible — do not guess.`
          : `These are ${frameCount} sequential frames from a BookTok video. Identify every distinct book shown across all frames. Read titles and authors directly from what's visible — do not guess.`,
      },
    ];

    const response = await client.messages.create({
      model: MODEL_ACCURATE,
      max_tokens: 2048,
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

    console.log(`[vision-extractor] Found ${parsed.length} books from ${frameCount} frames:`, JSON.stringify(parsed));

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
