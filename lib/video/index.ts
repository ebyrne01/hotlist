/**
 * Grab from Video — Main orchestrator
 *
 * NEW ARCHITECTURE (v2): Single Sonnet agent with tool use.
 *
 * Pipeline:
 * 1. Validate URL + check cache
 * 2. Download video/audio via RapidAPI
 * 3. Transcribe audio via Whisper (parallel with frame extraction)
 * 4. Extract frames from video via ffmpeg
 * 5. Send frames + transcript to Sonnet agent (vision + tool use)
 *    → Agent reads covers, understands transcript, searches Goodreads,
 *      and returns verified, canonical book identifications
 * 6. Queue enrichment for matched books
 * 7. Cache result
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { getVideoDownloadUrl, detectPlatform } from "./downloader";
import { transcribeAudio } from "./transcription";
import { extractFrames } from "./frame-extractor";
import { identifyBooksWithAgent } from "./book-agent";
import type { ResolvedBook } from "./book-resolver";
import { queueEnrichmentJobs } from "@/lib/enrichment/queue";
import { registerCreatorMentions } from "@/lib/creators/register";

export type GrabStatus =
  | "downloading"
  | "transcribing"
  | "scanning"
  | "extracting"
  | "identifying"
  | "done";

export type GrabErrorCode =
  | "invalid_url"
  | "video_unavailable"
  | "transcription_failed"
  | "no_books_found";

export interface GrabResultSuccess {
  success: true;
  platform: "tiktok" | "instagram" | "youtube";
  creatorHandle: string | null;
  thumbnailUrl: string | null;
  booksFound: number;
  books: ResolvedBook[];
  transcript: string;
  processingTimeMs: number;
}

export interface GrabResultError {
  success: false;
  error: GrabErrorCode;
  transcript?: string;
}

export type GrabResult = GrabResultSuccess | GrabResultError;

/**
 * Check if a URL was already processed and return cached result.
 */
export async function getCachedGrab(url: string): Promise<GrabResultSuccess | null> {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("video_grabs")
    .select("*")
    .eq("url", normalizeUrl(url))
    .single();

  if (!data) return null;

  return {
    success: true,
    platform: data.platform as "tiktok" | "instagram" | "youtube",
    creatorHandle: data.creator_handle,
    thumbnailUrl: data.thumbnail_url,
    booksFound: (data.extracted_books as ResolvedBook[])?.length ?? 0,
    books: (data.extracted_books as ResolvedBook[]) ?? [],
    transcript: data.transcript ?? "",
    processingTimeMs: 0, // cached
  };
}

/**
 * Save a grab result to cache so the same URL is never processed twice.
 */
async function cacheGrabResult(
  url: string,
  result: GrabResultSuccess,
  userId?: string
): Promise<string | null> {
  const supabase = getAdminClient();
  const { data } = await supabase.from("video_grabs").upsert(
    {
      url: normalizeUrl(url),
      platform: result.platform,
      creator_handle: result.creatorHandle,
      thumbnail_url: result.thumbnailUrl,
      transcript: result.transcript,
      extracted_books: result.books as unknown as Record<string, unknown>[],
      user_id: userId ?? null,
    },
    { onConflict: "url" }
  ).select("id").single();
  return data?.id ?? null;
}

/**
 * Normalize URL for dedup (strip tracking params, trailing slashes).
 */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Remove common tracking params
    u.searchParams.delete("utm_source");
    u.searchParams.delete("utm_medium");
    u.searchParams.delete("utm_campaign");
    u.searchParams.delete("is_copy_url");
    u.searchParams.delete("is_from_webapp");
    return u.toString().replace(/\/+$/, "");
  } catch {
    return url.trim();
  }
}

/**
 * Main orchestrator — processes a video URL end-to-end.
 *
 * New v2 pipeline:
 * 1. Validate URL + check cache
 * 2. Download video/audio via RapidAPI
 * 3. Transcribe audio + extract frames (parallel)
 * 4. Single Sonnet agent call: vision + transcript + Goodreads tool use
 * 5. Queue enrichment for matched books
 * 6. Cache result
 */
export async function grabBooksFromVideo(
  url: string,
  onStatus?: (status: GrabStatus) => void,
  userId?: string
): Promise<GrabResult> {
  const start = Date.now();

  // Step 1: Validate URL
  const platform = detectPlatform(url);
  if (platform === "unknown") {
    return { success: false, error: "invalid_url" };
  }

  // Step 2: Check cache
  const cached = await getCachedGrab(url);
  if (cached) return cached;

  // Step 3: Download video/audio
  onStatus?.("downloading");
  const download = await getVideoDownloadUrl(url);
  if (!download) {
    return { success: false, error: "video_unavailable" };
  }

  // Prefer audio URL for transcription — fall back to video
  const mediaUrl = download.audioUrl ?? download.videoUrl;
  if (!mediaUrl) {
    return { success: false, error: "video_unavailable" };
  }

  const creatorHandle = download.creatorHandle ?? null;

  // Step 4: Transcribe audio + extract frames in parallel
  onStatus?.("transcribing");

  const framePipeline = (async (): Promise<(string | Buffer)[]> => {
    const videoUrl = download.videoUrl;
    if (videoUrl) {
      onStatus?.("scanning");
      const frames = await extractFrames(videoUrl, download.durationSeconds);
      if (frames.length > 0) {
        console.log(`[grab] Extracted ${frames.length} frames`);
        return frames;
      }
    }
    // Fall back to thumbnail
    if (download.thumbnailUrl) {
      console.log("[grab] Frame extraction unavailable, using thumbnail");
      return [download.thumbnailUrl];
    }
    return [];
  })();

  const [transcription, frames] = await Promise.all([
    transcribeAudio(mediaUrl),
    framePipeline,
  ]);

  const transcript = transcription?.text?.trim() ?? "";

  if (!transcript && frames.length === 0) {
    return { success: false, error: "transcription_failed" };
  }

  // Step 5: Single Sonnet agent call — vision + transcript + Goodreads tools
  onStatus?.("identifying");
  console.log(`[grab] Starting book agent with ${frames.length} frames and ${transcript.length} chars of transcript`);

  const resolved = await identifyBooksWithAgent({
    frames,
    transcript: transcript || "(no transcript available — identify books from video frames only)",
    creatorHandle: creatorHandle ?? undefined,
    debugUrl: url,
  });

  console.log(
    `[grab] Agent identified ${resolved.length} books:`,
    JSON.stringify(resolved.map((b) => b.matched ? { matched: true, title: b.book.title } : { matched: false, rawTitle: b.rawTitle }))
  );

  if (resolved.length === 0 && transcript) {
    return {
      success: false,
      error: "no_books_found",
      transcript,
    };
  }

  // Step 6: Queue enrichment for all matched books (fire-and-forget)
  queueEnrichmentForResolved(resolved);

  const result: GrabResultSuccess = {
    success: true,
    platform,
    creatorHandle,
    thumbnailUrl: download.thumbnailUrl,
    booksFound: resolved.length,
    books: resolved,
    transcript,
    processingTimeMs: Date.now() - start,
  };

  // Step 7: Cache result
  const grabId = await cacheGrabResult(url, result, userId);

  // Step 8: Register creator handle and book mentions (fire-and-forget)
  if (result.creatorHandle && grabId) {
    registerCreatorMentions({
      handle: result.creatorHandle,
      platform,
      videoUrl: url,
      videoGrabId: grabId,
      books: resolved,
    }).catch((err) => {
      console.warn("[grab] Failed to register creator mentions:", err);
    });
  }

  onStatus?.("done");
  return result;
}

/**
 * Queue enrichment for all matched books (fire-and-forget).
 * Uses the user's wait time productively — enrichment starts immediately
 * so data is ready (or nearly ready) when books land in a hotlist.
 */
function queueEnrichmentForResolved(resolved: ResolvedBook[]) {
  for (const book of resolved) {
    if (book.matched) {
      queueEnrichmentJobs(book.book.id, book.book.title, book.book.author, {
        hasGoodreadsId: !!book.book.goodreadsId,
      }).catch((err) =>
        console.warn(`[grab] Failed to queue enrichment for "${book.book.title}":`, err)
      );
    }
  }
}
