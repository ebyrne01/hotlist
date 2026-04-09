/**
 * One-off script: Backfill is_audiobook for all books with cover URLs.
 *
 * Fetches the first 32KB of each cover image, reads PNG/JPEG headers
 * for dimensions, and sets is_audiobook = true for square covers.
 *
 * Usage: npx tsx scripts/backfill-audiobook.ts
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SQUARE_THRESHOLD = 1.15;
const BATCH_SIZE = 100;
const CONCURRENCY = 10;

interface Dimensions {
  width: number;
  height: number;
}

function readImageDimensions(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 24) return null;

  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    return width > 0 && height > 0 ? { width, height } : null;
  }

  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length - 8) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1];
      if (marker >= 0xc0 && marker <= 0xc3 && marker !== 0xc1) {
        const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        return width > 0 && height > 0 ? { width, height } : null;
      }
      const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
      offset += 2 + segLen;
    }
  }

  return null;
}

async function checkCover(url: string): Promise<boolean | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Range: "bytes=0-32767" },
    });
    clearTimeout(timeout);
    if (!res.ok && res.status !== 206) return null;

    const buffer = await res.arrayBuffer();
    const dims = readImageDimensions(new Uint8Array(buffer));
    if (!dims) return null;

    const ratio = dims.height / dims.width;
    return ratio < SQUARE_THRESHOLD;
  } catch {
    return null;
  }
}

async function main() {
  let offset = 0;
  let totalProcessed = 0;
  let audiobookCount = 0;
  let failedCount = 0;

  console.log("Starting audiobook backfill...");

  while (true) {
    const { data: books, error } = await supabase
      .from("books")
      .select("id, title, cover_url")
      .not("cover_url", "is", null)
      .order("created_at", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error("DB error:", error.message);
      break;
    }
    if (!books || books.length === 0) break;

    // Process in parallel chunks
    for (let i = 0; i < books.length; i += CONCURRENCY) {
      const chunk = books.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(async (book) => {
          const isAudiobook = await checkCover(book.cover_url);
          if (isAudiobook === null) {
            failedCount++;
            return;
          }
          if (isAudiobook) {
            await supabase.from("books").update({ is_audiobook: true }).eq("id", book.id);
            audiobookCount++;
            console.log(`  🎧 "${book.title}" → audiobook`);
          }
          totalProcessed++;
        })
      );
    }

    console.log(`Processed ${offset + books.length} books (${audiobookCount} audiobooks found, ${failedCount} failed)`);
    offset += BATCH_SIZE;

    // Small delay between batches
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nDone! ${totalProcessed} checked, ${audiobookCount} audiobooks detected, ${failedCount} failed.`);
}

main().catch(console.error);
