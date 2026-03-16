/**
 * FRAME EXTRACTION — Extract keyframes from video for vision analysis.
 *
 * Uses ffmpeg-static to extract frames at regular intervals from a video URL.
 * Frames are written to /tmp, read as Buffers, then cleaned up.
 *
 * Design constraints:
 * - Vercel serverless: /tmp has 512MB (Pro) or 256MB (Hobby)
 * - TikTok videos are typically 15-60s, 5-20MB
 * - We extract 1 frame per 2 seconds, capped at MAX_FRAMES
 * - Frames are resized to 512px wide to keep Sonnet vision costs down
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

const execFileAsync = promisify(execFile);
const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const mkdir = promisify(fs.mkdir);
const rm = promisify(fs.rm);

/** Max frames to extract — more frames = better coverage of fast-moving haul videos */
const MAX_FRAMES = 30;

/** Extract 1 frame every N seconds (1 = every second, catches fast-scrolling titles) */
const FRAME_INTERVAL_SECONDS = 1;

/** Resize frames to this width (pixels) — higher res = better OCR on book covers */
const FRAME_WIDTH = 768;

/**
 * Extract frames from a video URL at regular intervals.
 *
 * Returns an array of JPEG Buffers (one per frame).
 * Returns empty array on failure — never throws.
 *
 * @param videoUrl - Direct URL to the video file
 * @param durationSeconds - Video duration (if known) for smarter interval calculation
 */
export async function extractFrames(
  videoUrl: string,
  durationSeconds?: number | null
): Promise<Buffer[]> {
  // Resolve ffmpeg binary path
  let ffmpegPath: string;
  try {
    // ffmpeg-static exports the path to the binary
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ffmpegPath = require("ffmpeg-static");
    if (!ffmpegPath) throw new Error("ffmpeg-static returned null");
    // Verify the binary actually exists at that path
    if (!fs.existsSync(ffmpegPath)) {
      throw new Error(`ffmpeg binary not found at ${ffmpegPath}`);
    }
  } catch (err) {
    console.warn("[frame-extractor] ffmpeg-static not available:", err);
    // Fallback: try system ffmpeg (available in some Vercel runtimes)
    try {
      await execFileAsync("ffmpeg", ["-version"], { timeout: 5000 });
      ffmpegPath = "ffmpeg";
      console.log("[frame-extractor] Using system ffmpeg");
    } catch {
      console.error("[frame-extractor] No ffmpeg available — frame extraction disabled");
      return [];
    }
  }

  const jobId = crypto.randomBytes(4).toString("hex");
  const tmpDir = path.join(os.tmpdir(), `hotlist-frames-${jobId}`);

  try {
    await mkdir(tmpDir, { recursive: true });

    // Calculate frame interval based on duration
    let fps: string;
    if (durationSeconds && durationSeconds > 0) {
      // Aim for MAX_FRAMES evenly spaced, but at least 1 frame per FRAME_INTERVAL_SECONDS
      const idealInterval = Math.max(
        FRAME_INTERVAL_SECONDS,
        durationSeconds / MAX_FRAMES
      );
      fps = `1/${Math.round(idealInterval)}`;
    } else {
      fps = `1/${FRAME_INTERVAL_SECONDS}`;
    }

    // Extract frames using ffmpeg
    // -i: input URL
    // -vf: video filter (fps + scale)
    // -frames:v: max frames to output
    // -q:v 2: high quality JPEG
    // -f image2: output as image sequence
    const outputPattern = path.join(tmpDir, "frame-%03d.jpg");

    await execFileAsync(
      ffmpegPath,
      [
        "-i", videoUrl,
        "-vf", `fps=${fps},scale=${FRAME_WIDTH}:-1`,
        "-frames:v", String(MAX_FRAMES),
        "-q:v", "2",
        "-f", "image2",
        outputPattern,
      ],
      {
        timeout: 30_000, // 30s timeout for download + extraction
        maxBuffer: 10 * 1024 * 1024, // 10MB stdout buffer
      }
    );

    // Read all extracted frame files
    const files = (await readdir(tmpDir))
      .filter((f) => f.startsWith("frame-") && f.endsWith(".jpg"))
      .sort(); // Ensures chronological order (frame-001, frame-002, ...)

    if (files.length === 0) {
      console.warn("[frame-extractor] No frames extracted");
      return [];
    }

    const frames: Buffer[] = [];
    for (const file of files) {
      const buf = await readFile(path.join(tmpDir, file));
      frames.push(buf);
    }

    console.log(`[frame-extractor] Extracted ${frames.length} frames from video`);
    return frames;
  } catch (err) {
    console.error("[frame-extractor] Failed:", err);
    return [];
  } finally {
    // Cleanup tmp directory
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
