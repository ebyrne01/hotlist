/**
 * Grab from Video — Main orchestrator
 *
 * Coordinates: URL validation → video download → transcription →
 * multi-frame vision → transcript extraction → reconciliation →
 * Goodreads resolution → cached result.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { getVideoDownloadUrl, detectPlatform } from "./downloader";
import { transcribeAudio } from "./transcription";
import { extractBooksFromTranscript, correctExtractedBooks } from "./book-extractor";
import { extractBooksFromFrames } from "./vision-extractor";
import { extractFrames } from "./frame-extractor";
import { reconcileBooks } from "./reconciler";
import { resolveExtractedBooks, type ResolvedBook } from "./book-resolver";
import { queueEnrichmentJobs } from "@/lib/enrichment/queue";

export type GrabStatus =
  | "downloading"
  | "transcribing"
  | "scanning"
  | "extracting"
  | "correcting"
  | "reconciling"
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
 * Pipeline:
 * 1. Validate URL + check cache
 * 2. Download video/audio via RapidAPI
 * 3. Transcribe audio via Whisper (parallel with steps 4-5)
 * 4. Extract frames from video via ffmpeg (parallel with step 3)
 * 5. Read book covers from frames via Claude Sonnet vision
 * 6. Extract book mentions from transcript via Claude Haiku
 * 7. Correct transcription errors via Claude Sonnet
 * 8. Reconcile vision + transcript books via Claude Sonnet
 * 9. Resolve each book to database/Goodreads
 * 10. Queue enrichment for matched books
 * 11. Cache result
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

  // Steps 4-5 (vision) and Step 3 (transcription) run in parallel
  // Vision pipeline: extract frames → read covers
  // Transcription: audio → text
  onStatus?.("transcribing");

  const visionPipeline = (async () => {
    // Try multi-frame extraction from the video file first
    const videoUrl = download.videoUrl;
    if (videoUrl) {
      onStatus?.("scanning");
      const frames = await extractFrames(videoUrl, download.durationSeconds);
      if (frames.length > 0) {
        console.log(`[grab] Extracted ${frames.length} frames, sending to vision`);
        return extractBooksFromFrames(frames, creatorHandle ?? undefined);
      }
    }

    // Fall back to thumbnail if frame extraction failed
    if (download.thumbnailUrl) {
      onStatus?.("scanning");
      console.log("[grab] Frame extraction unavailable, falling back to thumbnail");
      return extractBooksFromFrames([download.thumbnailUrl], creatorHandle ?? undefined);
    }

    return [];
  })();

  const [transcription, visionBooks] = await Promise.all([
    transcribeAudio(mediaUrl),
    visionPipeline,
  ]);

  if (!transcription || !transcription.text.trim()) {
    // Even without transcript, vision alone might have found books
    if (visionBooks.length > 0) {
      onStatus?.("resolving");
      const resolved = await resolveExtractedBooks(visionBooks);
      queueEnrichmentForResolved(resolved);

      const result: GrabResultSuccess = {
        success: true,
        platform,
        creatorHandle,
        thumbnailUrl: download.thumbnailUrl,
        booksFound: resolved.length,
        books: resolved,
        transcript: "",
        processingTimeMs: Date.now() - start,
      };
      await cacheGrabResult(url, result, userId);
      onStatus?.("done");
      return result;
    }

    return { success: false, error: "transcription_failed" };
  }

  // Step 6: Extract book mentions from transcript
  onStatus?.("extracting");
  const extracted = await extractBooksFromTranscript(
    transcription.text,
    creatorHandle ?? undefined
  );

  if (extracted.length === 0 && visionBooks.length === 0) {
    return {
      success: false,
      error: "no_books_found",
      transcript: transcription.text,
    };
  }

  // Step 7: Correct transcription errors in titles/authors
  onStatus?.("correcting");
  const corrected = await correctExtractedBooks(extracted);

  // Step 8: Reconcile vision + transcript books
  // This replaces the old naive word-overlap merge with an intelligent
  // cross-reference that matches descriptions to covers.
  onStatus?.("reconciling");
  const reconciled = await reconcileBooks({
    visionBooks,
    transcriptBooks: corrected,
    transcript: transcription.text,
  });

  // Step 9: Resolve to our database
  onStatus?.("resolving");
  const resolved = await resolveExtractedBooks(reconciled);

  // Step 10: Queue enrichment for all matched books (fire-and-forget)
  queueEnrichmentForResolved(resolved);

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

  // Step 11: Cache result
  await cacheGrabResult(url, result, userId);

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
