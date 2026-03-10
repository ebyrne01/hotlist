/**
 * Grab from Video — Main orchestrator
 *
 * Coordinates: URL validation → video download → transcription →
 * book extraction → Goodreads resolution → cached result.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { getVideoDownloadUrl, detectPlatform } from "./downloader";
import { transcribeAudio } from "./transcription";
import { extractBooksFromTranscript } from "./book-extractor";
import { resolveExtractedBooks, type ResolvedBook } from "./book-resolver";

export type GrabStatus =
  | "downloading"
  | "transcribing"
  | "extracting"
  | "resolving"
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
): Promise<void> {
  const supabase = getAdminClient();
  await supabase.from("video_grabs").upsert(
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
  );
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
 * @param url - TikTok, Instagram, or YouTube URL
 * @param onStatus - callback for progress updates (for streaming UI)
 * @param userId - optional user ID to associate with the grab
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

  // Prefer audio URL (smaller, faster) — fall back to video
  const mediaUrl = download.audioUrl ?? download.videoUrl;
  if (!mediaUrl) {
    return { success: false, error: "video_unavailable" };
  }

  // Step 4: Transcribe
  onStatus?.("transcribing");
  const transcription = await transcribeAudio(mediaUrl);
  if (!transcription || !transcription.text.trim()) {
    return { success: false, error: "transcription_failed" };
  }

  // Step 5: Extract book mentions
  onStatus?.("extracting");
  const creatorHandle =
    download.creatorHandle ?? null;
  const extracted = await extractBooksFromTranscript(
    transcription.text,
    creatorHandle ?? undefined
  );

  if (extracted.length === 0) {
    return {
      success: false,
      error: "no_books_found",
      transcript: transcription.text,
    };
  }

  // Step 6: Resolve to our database
  onStatus?.("resolving");
  const resolved = await resolveExtractedBooks(extracted);

  const result: GrabResultSuccess = {
    success: true,
    platform,
    creatorHandle,
    thumbnailUrl: download.thumbnailUrl,
    booksFound: resolved.length,
    books: resolved,
    transcript: transcription.text,
    processingTimeMs: Date.now() - start,
  };

  // Step 7: Cache result
  await cacheGrabResult(url, result, userId);

  onStatus?.("done");
  return result;
}
