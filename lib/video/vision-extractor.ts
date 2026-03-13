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

const VISION_SYSTEM_PROMPT = `You are a book cover reader for a BookTok video analysis tool. You will receive sequential frames from a short video (typically 15-60 seconds). Your job is to identify every distinct book shown in the video.

WHAT TO LOOK FOR:
- Book covers being held up, displayed, or shown to the camera
- Title and author text printed on book covers
- Book spines with readable text
- On-screen text overlays listing book titles (e.g., "books I read this month" lists)
- Title cards, captions, or text graphics showing book names
- Screenshots of Amazon, Goodreads, or bookstore listings

IMPORTANT:
- The same book may appear in multiple consecutive frames — deduplicate. Only list each book ONCE.
- Read the EXACT text from the cover. Do not guess or infer titles — only report what you can actually read.
- If a cover is partially visible or blurry, report what you CAN read and set confidence accordingly.
- Author names are often in smaller text below the title — look carefully.

For each book, extract:
- title: The title as printed on the cover or screen (exact text, not a guess)
- author: The author name if visible (null if not readable)
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

    console.log(`[vision-extractor] Found ${parsed.length} books from ${frameCount} frames`);

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
