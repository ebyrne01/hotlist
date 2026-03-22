/**
 * Server-side audiobook detection via cover image aspect ratio.
 *
 * Audiobook covers are square (1:1). Print/ebook covers are ~1.5:1.
 * We fetch just the image headers to get dimensions without downloading
 * the full image, then persist `is_audiobook` on the books table.
 */

import { getAdminClient } from "@/lib/supabase/admin";

const SQUARE_THRESHOLD = 1.15; // height/width below this = audiobook

/**
 * Check if a cover image is square (audiobook) by fetching it and
 * reading dimensions. Returns true for audiobook, false otherwise.
 * Returns null if we can't determine (no URL, fetch fails, etc.).
 */
export async function detectAudiobookCover(coverUrl: string | null): Promise<boolean | null> {
  if (!coverUrl) return null;

  try {
    // Fetch the image to read dimensions via response headers or content
    // Most CDNs don't return image dimensions in headers, so we need to
    // fetch enough bytes to read the image header (first ~32KB is plenty).
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(coverUrl, {
      signal: controller.signal,
      headers: { Range: "bytes=0-32767" },
    });
    clearTimeout(timeout);

    if (!res.ok && res.status !== 206) return null;

    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Try to read dimensions from image headers
    const dims = readImageDimensions(bytes);
    if (!dims) return null;

    const ratio = dims.height / dims.width;
    return ratio < SQUARE_THRESHOLD;
  } catch {
    return null;
  }
}

interface Dimensions {
  width: number;
  height: number;
}

/**
 * Read width/height from PNG or JPEG headers.
 */
function readImageDimensions(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 24) return null;

  // PNG: bytes 0-7 are signature, IHDR chunk starts at 8
  // Width at offset 16 (4 bytes big-endian), height at offset 20
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // JPEG: scan for SOF0 (0xFFC0) or SOF2 (0xFFC2) marker
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length - 8) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      // SOF0, SOF1, SOF2, SOF3
      if (marker >= 0xc0 && marker <= 0xc3 && marker !== 0xc1) {
        const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        return width > 0 && height > 0 ? { width, height } : null;
      }
      // Skip this marker segment
      const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
      offset += 2 + segLen;
    }
  }

  return null;
}

/**
 * Detect audiobook status for a book and persist it.
 * Called during enrichment when we have a cover_url.
 */
export async function detectAndSaveAudiobookStatus(
  bookId: string,
  coverUrl: string | null
): Promise<void> {
  const isAudiobook = await detectAudiobookCover(coverUrl);
  if (isAudiobook === null) return;

  const supabase = getAdminClient();
  await supabase
    .from("books")
    .update({ is_audiobook: isAudiobook })
    .eq("id", bookId);
}
