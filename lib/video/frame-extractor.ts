/**
 * FRAME EXTRACTION — Extract keyframes from video for vision analysis.
 *
 * Uses ffmpeg-static to extract frames at regular intervals from a video URL.
 * Frames are written to /tmp, read as Buffers, then cleaned up.
 *
 * Design constraints:
 * - Vercel serverless: /tmp has 512MB (Pro) or 256MB (Hobby)
 * - TikTok videos are typically 15-180s, 5-30MB
 * - MAX_FRAMES frames evenly spaced across the full video duration
 * - When duration is unknown from downloader, probes it via ffmpeg
 * - Frames are resized to 512px wide to keep vision costs down
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

/** Resize frames to this width (pixels) — 512px is readable for covers while keeping vision token cost low */
const FRAME_WIDTH = 512;

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
  durationSeconds?: number | null,
  overrides?: { fpsOverride?: number; maxFramesOverride?: number }
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

  // If duration is unknown, probe it from the video stream so we can space frames across the full video
  let effectiveDuration = durationSeconds;
  if (!effectiveDuration && !overrides?.fpsOverride) {
    try {
      // Use -t 0 to read only the header (no decoding), ffmpeg prints duration to stderr then exits
      const { stderr } = await execFileAsync(
        ffmpegPath,
        ["-i", videoUrl, "-t", "0", "-f", "null", "-"],
        { timeout: 10_000, maxBuffer: 1 * 1024 * 1024 }
      ).catch((err: { stderr?: string }) => ({ stderr: err.stderr || "" }));
      const match = stderr?.match(/Duration:\s*(\d+):(\d+):(\d[\d.]*)/);
      if (match) {
        effectiveDuration = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
        console.log(`[frame-extractor] Probed video duration: ${effectiveDuration.toFixed(1)}s`);
      }
    } catch {
      // Non-fatal — will fall back to default 1fps
    }
  }

  const jobId = crypto.randomBytes(4).toString("hex");
  const tmpDir = path.join(os.tmpdir(), `hotlist-frames-${jobId}`);

  try {
    await mkdir(tmpDir, { recursive: true });

    // Calculate frame interval based on duration
    const maxFrames = overrides?.maxFramesOverride ?? MAX_FRAMES;
    const frameInterval = overrides?.fpsOverride ? (1 / overrides.fpsOverride) : FRAME_INTERVAL_SECONDS;
    let fps: string;
    if (overrides?.fpsOverride) {
      fps = String(overrides.fpsOverride);
    } else if (effectiveDuration && effectiveDuration > 0) {
      // Aim for maxFrames evenly spaced, but at least 1 frame per frameInterval
      const idealInterval = Math.max(
        frameInterval,
        effectiveDuration / maxFrames
      );
      fps = `1/${Math.round(idealInterval)}`;
    } else {
      fps = `1/${frameInterval}`;
    }

    // Extract frames using ffmpeg
    // -i: input URL
    // -vf: video filter (fps + scale)
    // -frames:v: max frames to output
    // -q:v 2: high quality JPEG
    // -f image2: output as image sequence
    const outputPattern = path.join(tmpDir, "frame-%03d.jpg");

    // Extract the very first frame separately to catch books shown at t=0
    // (the fps filter centers its window, missing the first ~0.5s)
    const firstFramePath = path.join(tmpDir, "frame-000.jpg");
    try {
      await execFileAsync(
        ffmpegPath,
        [
          "-i", videoUrl,
          "-vf", `scale=${FRAME_WIDTH}:-1`,
          "-frames:v", "1",
          "-q:v", "2",
          firstFramePath,
        ],
        { timeout: 10_000, maxBuffer: 5 * 1024 * 1024 }
      );
    } catch {
      // Non-fatal — we'll still get frames from the fps pass
    }

    await execFileAsync(
      ffmpegPath,
      [
        "-i", videoUrl,
        "-vf", `fps=${fps},scale=${FRAME_WIDTH}:-1`,
        "-frames:v", String(maxFrames),
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
