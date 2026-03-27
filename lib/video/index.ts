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
import { identifyBooksWithAgent, identifyBooksWithAgentDebug, type AgentDiagnostics } from "./book-agent";
import type { ResolvedBook } from "./book-resolver";
import { preprocessTranscript } from "./transcript-preprocessor";
import { queueEnrichmentJobs } from "@/lib/enrichment/queue";
import { processEnrichmentQueue } from "@/lib/enrichment/worker";
import { registerCreatorMentions } from "@/lib/creators/register";
import { validateAgentResultsWithCaption } from "./caption-validator";

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

/** Diagnostic data captured when debug mode is enabled */
export interface PipelineDiagnostics {
  /** Raw transcript text from Whisper */
  transcript: string;

  /** What the Sonnet agent submitted via submit_books tool */
  extractedRaw: Array<{
    title: string;
    author: string;
    goodreadsId?: string | null;
    sentiment?: string;
    quote?: string;
  }>;

  /** Agent tool call log — search_goodreads and confirm_book calls */
  matchAttempts: Array<{
    tool: "search_goodreads" | "confirm_book";
    input: Record<string, unknown>;
    output: Record<string, unknown> | Record<string, unknown>[];
    turn: number;
  }>;

  /** Enrichment results for matched books */
  enrichmentResults: Array<{
    bookId: string;
    title: string;
    hasGoodreadsRating: boolean;
    hasAmazonRating: boolean;
    hasSpice: boolean;
    hasTropes: boolean;
  }>;

  /** Timing for each pipeline stage in milliseconds */
  timing: {
    downloadMs: number;
    transcriptionMs: number;
    frameExtractionMs: number;
    observeMs: number;
    verifyMs: number;
    enrichmentMs: number;
    totalMs: number;
  };

  /** Number of frames sent to the agent */
  frameCount: number;
  /** Number of agent turns (API calls) */
  agentTurns: number;
}

export interface GrabResultSuccess {
  success: true;
  platform: "tiktok" | "instagram" | "youtube";
  creatorHandle: string | null;
  thumbnailUrl: string | null;
  videoTitle: string | null;
  booksFound: number;
  books: ResolvedBook[];
  transcript: string;
  processingTimeMs: number;
  diagnostics?: PipelineDiagnostics;
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
    videoTitle: data.video_title ?? null,
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
      video_title: result.videoTitle,
      transcript: result.transcript,
      extracted_books: JSON.parse(JSON.stringify(result.books)),
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
/** Pipeline timeout: 4.5 minutes (leaves margin before Vercel's 5-min limit) */
const PIPELINE_TIMEOUT_MS = 270_000;

export async function grabBooksFromVideo(
  url: string,
  onStatus?: (status: GrabStatus) => void,
  userId?: string,
  debug?: boolean
): Promise<GrabResult> {
  // Step 1: Validate URL (fast, no timeout needed)
  const platform = detectPlatform(url);
  if (platform === "unknown") {
    return { success: false, error: "invalid_url" };
  }

  // Step 2: Check cache (fast, no timeout needed)
  const cached = await getCachedGrab(url);
  if (cached) return cached;

  // Race the rest of the pipeline against a timeout
  return Promise.race([
    grabPipeline(url, platform, onStatus, userId, debug),
    new Promise<GrabResult>((resolve) =>
      setTimeout(() => {
        console.error(`[grab] Pipeline timed out after ${PIPELINE_TIMEOUT_MS / 1000}s for ${url}`);
        resolve({ success: false, error: "video_unavailable" });
      }, PIPELINE_TIMEOUT_MS)
    ),
  ]);
}

async function grabPipeline(
  url: string,
  platform: "tiktok" | "instagram" | "youtube",
  onStatus?: (status: GrabStatus) => void,
  userId?: string,
  debug?: boolean
): Promise<GrabResult> {
  const start = Date.now();
  const timing = {
    downloadMs: 0,
    transcriptionMs: 0,
    frameExtractionMs: 0,
    observeMs: 0,
    verifyMs: 0,
    enrichmentMs: 0,
    totalMs: 0,
  };

  // Step 3: Download video/audio
  onStatus?.("downloading");
  const tDownload = Date.now();
  const download = await getVideoDownloadUrl(url);
  timing.downloadMs = Date.now() - tDownload;
  if (!download) {
    return { success: false, error: "video_unavailable" };
  }

  // Prefer audio URL for transcription — fall back to video
  const mediaUrl = download.audioUrl ?? download.videoUrl;
  const isCarousel = download.imageUrls.length > 0 && !download.videoUrl;

  if (!mediaUrl && !isCarousel) {
    return { success: false, error: "video_unavailable" };
  }

  const creatorHandle = download.creatorHandle ?? null;

  // Step 4: Transcribe audio + extract frames in parallel
  onStatus?.("transcribing");
  const tTranscribe = Date.now();

  const framePipeline = (async (): Promise<(string | Buffer)[]> => {
    const tFrames = Date.now();

    // Photo/carousel posts: use slide images directly, skip ffmpeg
    if (isCarousel) {
      console.log(`[grab] Carousel post: using ${download.imageUrls.length} slide images directly`);
      timing.frameExtractionMs = Date.now() - tFrames;
      return download.imageUrls;
    }

    const videoUrl = download.videoUrl;
    if (videoUrl) {
      onStatus?.("scanning");
      let frames = await extractFrames(videoUrl, download.durationSeconds);

      // If we got suspiciously few frames, the no-watermark video may be truncated.
      // When duration is known: expect at least half the duration in frames.
      // When duration is unknown: if we have <10 frames and alternatives exist, try them.
      const expectedMinFrames = download.durationSeconds
        ? Math.floor(download.durationSeconds * 0.5)
        : 10; // Unknown duration: always try fallbacks if we got fewer than 10 frames

      if (frames.length < expectedMinFrames && download.allVideoUrls.length > 1) {
        console.log(`[grab] Only ${frames.length} frames from primary URL (expected ~${expectedMinFrames}+), trying ${download.allVideoUrls.length - 1} fallback URLs`);
        for (const fallbackUrl of download.allVideoUrls) {
          if (fallbackUrl === videoUrl) continue;
          const fallbackFrames = await extractFrames(fallbackUrl, download.durationSeconds);
          if (fallbackFrames.length > frames.length) {
            console.log(`[grab] Fallback URL yielded ${fallbackFrames.length} frames (was ${frames.length})`);
            frames = fallbackFrames;
            break; // Use the first improvement
          }
        }
      }

      timing.frameExtractionMs = Date.now() - tFrames;
      if (frames.length > 0) {
        console.log(`[grab] Extracted ${frames.length} frames`);
        return frames;
      }
    }
    timing.frameExtractionMs = Date.now() - tFrames;
    // Fall back to thumbnail
    if (download.thumbnailUrl) {
      console.log("[grab] Frame extraction unavailable, using thumbnail");
      return [download.thumbnailUrl];
    }
    return [];
  })();

  // For carousel posts without audio, skip transcription
  const transcriptionPipeline = mediaUrl
    ? transcribeAudio(mediaUrl)
    : Promise.resolve(null);

  const [transcription, frames] = await Promise.all([
    transcriptionPipeline,
    framePipeline,
  ]);
  timing.transcriptionMs = Date.now() - tTranscribe;

  const transcript = transcription?.text?.trim() ?? "";

  if (!transcript && frames.length === 0) {
    return { success: false, error: "transcription_failed" };
  }

  // For carousel posts, the transcript is usually just background music — not useful
  const effectiveTranscript = isCarousel && frames.length > 0
    ? "(no transcript available — this is a photo/carousel post. Identify books from the images only)"
    : transcript || "(no transcript available — identify books from video frames only)";

  // Step 4b: Preprocess transcript — apply Whisper corrections + detect series mode
  const preprocessed = transcript
    ? preprocessTranscript(effectiveTranscript)
    : { correctedText: effectiveTranscript, isSeriesVideo: false };

  const agentTranscript = preprocessed.correctedText;

  // Step 5: Two-phase agent — Haiku observe + Sonnet verify
  onStatus?.("identifying");
  console.log(`[grab] Starting two-phase agent with ${frames.length} frames and ${agentTranscript.length} chars of transcript (series mode: ${preprocessed.isSeriesVideo})`);
  const tAgent = Date.now();

  let resolved: ResolvedBook[];
  let agentDiag: AgentDiagnostics | undefined;

  if (debug) {
    const result = await identifyBooksWithAgentDebug({
      frames,
      transcript: agentTranscript,
      creatorHandle: creatorHandle ?? undefined,
      debugUrl: url,
      isSeriesMode: preprocessed.isSeriesVideo,
      durationSeconds: download.durationSeconds ?? undefined,
    });
    resolved = result.books;
    agentDiag = result.diagnostics;
  } else {
    resolved = await identifyBooksWithAgent({
      frames,
      transcript: agentTranscript,
      creatorHandle: creatorHandle ?? undefined,
      debugUrl: url,
      isSeriesMode: preprocessed.isSeriesVideo,
      durationSeconds: download.durationSeconds ?? undefined,
    });
  }
  // Update timing from agent diagnostics if available
  if (agentDiag) {
    timing.observeMs = agentDiag.observeMs;
    timing.verifyMs = agentDiag.verifyMs;
  } else {
    // Non-debug mode: total agent time is all we have
    timing.observeMs = 0;
    timing.verifyMs = Date.now() - tAgent;
  }

  console.log(
    `[grab] Agent identified ${resolved.length} books:`,
    JSON.stringify(resolved.map((b) => b.matched ? { matched: true, title: b.book.title } : { matched: false, rawTitle: b.rawTitle }))
  );

  // Step 5b: Caption validation — cross-reference video title/caption against agent results
  // This is a backup check: if the caption explicitly names a book the agent missed,
  // or contradicts the agent's single pick, we correct the results.
  const videoTitle = download.videoTitle ?? null;
  if (videoTitle) {
    try {
      const { results: validated, captionOverrides } =
        await validateAgentResultsWithCaption(videoTitle, resolved);
      if (captionOverrides.length > 0) {
        console.log(`[grab] Caption validation applied ${captionOverrides.length} correction(s):`, captionOverrides);
        resolved = validated;
      }
    } catch (err) {
      console.warn("[grab] Caption validation failed (non-fatal):", err);
    }
  }

  if (resolved.length === 0 && transcript) {
    return {
      success: false,
      error: "no_books_found",
      transcript,
    };
  }

  // Step 6: Queue enrichment for all matched books, then kick off the worker immediately
  const tEnrich = Date.now();
  queueEnrichmentForResolved(resolved);
  timing.enrichmentMs = Date.now() - tEnrich;

  // Kick off enrichment worker immediately so ratings appear within seconds, not 5 minutes
  processEnrichmentQueue(30_000).catch((err) => {
    console.warn("[grab] Fire-and-forget enrichment worker failed:", err);
  });
  timing.totalMs = Date.now() - start;

  // Build diagnostics if debug mode
  let diagnostics: PipelineDiagnostics | undefined;
  if (debug && agentDiag) {
    diagnostics = {
      transcript,
      extractedRaw: agentDiag.submittedBooks.map((b) => ({
        title: b.title,
        author: b.author,
        goodreadsId: b.goodreads_id ?? null,
        sentiment: b.sentiment,
        quote: b.creator_quote,
      })),
      matchAttempts: agentDiag.toolCalls,
      enrichmentResults: resolved
        .filter((r): r is ResolvedBook & { matched: true } => r.matched)
        .map((r) => ({
          bookId: r.book.id,
          title: r.book.title,
          hasGoodreadsRating: r.book.ratings?.some((rt) => rt.source === "goodreads" && rt.rating != null) ?? false,
          hasAmazonRating: r.book.ratings?.some((rt) => rt.source === "amazon" && rt.rating != null) ?? false,
          hasSpice: (r.book.spice?.length ?? 0) > 0,
          hasTropes: (r.book.tropes?.length ?? 0) > 0,
        })),
      timing,
      frameCount: frames.length,
      agentTurns: agentDiag.turns,
    };
  }

  const result: GrabResultSuccess = {
    success: true,
    platform,
    creatorHandle,
    thumbnailUrl: download.thumbnailUrl,
    videoTitle: download.videoTitle ?? null,
    booksFound: resolved.length,
    books: resolved,
    transcript,
    processingTimeMs: Date.now() - start,
    diagnostics,
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
      queueEnrichmentJobs(book.book.id, book.book.title, book.book.author).catch((err) =>
        console.warn(`[grab] Failed to queue enrichment for "${book.book.title}":`, err)
      );
    }
  }
}
