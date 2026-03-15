/**
 * POST /api/grab/diagnose
 *
 * Lightweight diagnostic endpoint that runs ONLY download + transcription +
 * frame extraction — no agent identification, no enrichment.
 * Returns in ~20 seconds. Useful for quickly checking "what does Whisper hear?"
 *
 * Request body: { url: string }
 * Response: { url, transcript, frameCount, timing }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getVideoDownloadUrl, detectPlatform } from "@/lib/video/downloader";
import { transcribeAudio } from "@/lib/video/transcription";
import { extractFrames } from "@/lib/video/frame-extractor";
import { CORS_HEADERS } from "@/lib/api/cors";

export const maxDuration = 60;

const bodySchema = z.object({
  url: z
    .string()
    .url()
    .refine(
      (url) => {
        const lower = url.toLowerCase();
        return (
          lower.includes("tiktok.com") ||
          lower.includes("instagram.com") ||
          lower.includes("youtube.com") ||
          lower.includes("youtu.be")
        );
      },
      { message: "URL must be a TikTok, Instagram, or YouTube link" }
    ),
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  let body: { url: string };
  try {
    const raw = await req.json();
    body = bodySchema.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "Invalid request. Please provide a valid TikTok, Instagram, or YouTube URL." },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const timing: Record<string, number> = {};

  try {
    // Step 1: Validate URL
    const platform = detectPlatform(body.url);
    if (platform === "unknown") {
      return NextResponse.json(
        { error: "Unsupported platform. Must be TikTok, Instagram, or YouTube." },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Step 2: Download video/audio
    const tDownload = Date.now();
    const download = await getVideoDownloadUrl(body.url);
    timing.downloadMs = Date.now() - tDownload;

    if (!download) {
      return NextResponse.json(
        { error: "Could not download video.", timing },
        { status: 422, headers: CORS_HEADERS }
      );
    }

    const mediaUrl = download.audioUrl ?? download.videoUrl;
    if (!mediaUrl) {
      return NextResponse.json(
        { error: "No audio or video URL found.", timing },
        { status: 422, headers: CORS_HEADERS }
      );
    }

    // Step 3: Transcribe audio + extract frames in parallel
    const tParallel = Date.now();

    const framePipeline = (async (): Promise<number> => {
      const videoUrl = download.videoUrl;
      if (videoUrl) {
        const frames = await extractFrames(videoUrl, download.durationSeconds);
        return frames.length;
      }
      return download.thumbnailUrl ? 1 : 0;
    })();

    const [transcription, frameCount] = await Promise.all([
      transcribeAudio(mediaUrl),
      framePipeline,
    ]);
    timing.transcriptionMs = Date.now() - tParallel;

    const transcript = transcription?.text?.trim() ?? "";

    return NextResponse.json(
      {
        url: body.url,
        platform,
        creatorHandle: download.creatorHandle ?? null,
        transcript,
        transcriptLength: transcript.length,
        frameCount,
        timing,
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error("[/api/grab/diagnose] Pipeline error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Pipeline failed",
        timing,
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
