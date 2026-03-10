/**
 * Video Downloader — RapidAPI integration
 *
 * Given a TikTok, Instagram, or YouTube URL, returns a direct
 * URL to the video/audio file via a third-party RapidAPI service.
 */

export interface VideoDownloadResult {
  audioUrl: string | null;
  videoUrl: string | null;
  platform: "tiktok" | "instagram" | "youtube" | "unknown";
  creatorHandle: string | null;
  videoTitle: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
}

/**
 * Detect which platform a URL belongs to.
 */
export function detectPlatform(
  url: string
): "tiktok" | "instagram" | "youtube" | "unknown" {
  const lower = url.toLowerCase();
  if (lower.includes("tiktok.com") || lower.includes("vm.tiktok.com"))
    return "tiktok";
  if (lower.includes("instagram.com")) return "instagram";
  if (
    lower.includes("youtube.com") ||
    lower.includes("youtu.be") ||
    lower.includes("youtube.com/shorts")
  )
    return "youtube";
  return "unknown";
}

/**
 * Extract creator handle from URL where possible.
 */
function extractCreatorHandle(url: string, platform: string): string | null {
  try {
    if (platform === "tiktok") {
      const match = url.match(/@([^/?\s]+)/);
      return match ? `@${match[1]}` : null;
    }
    if (platform === "instagram") {
      // Instagram reel URLs don't always have the handle
      const match = url.match(/instagram\.com\/([^/]+)\//);
      if (match && !["p", "reel", "reels", "stories"].includes(match[1])) {
        return `@${match[1]}`;
      }
    }
  } catch {
    // Ignore parsing errors
  }
  return null;
}

/**
 * Download video/audio URL via RapidAPI.
 * Returns null on any failure — never throws.
 */
export async function getVideoDownloadUrl(
  url: string
): Promise<VideoDownloadResult | null> {
  const platform = detectPlatform(url);
  if (platform === "unknown") {
    console.warn("[downloader] Unsupported platform:", url);
    return null;
  }

  const apiKey = process.env.RAPIDAPI_KEY;
  const apiHost = process.env.RAPIDAPI_VIDEO_HOST;

  if (!apiKey || !apiHost) {
    console.error("[downloader] Missing RAPIDAPI_KEY or RAPIDAPI_VIDEO_HOST");
    return null;
  }

  const creatorHandle = extractCreatorHandle(url, platform);

  try {
    const response = await fetch(
      `https://${apiHost}/api/download?url=${encodeURIComponent(url)}`,
      {
        method: "GET",
        headers: {
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": apiHost,
        },
      }
    );

    if (!response.ok) {
      console.error(
        `[downloader] RapidAPI returned ${response.status}:`,
        await response.text()
      );
      return null;
    }

    const data = await response.json();

    // RapidAPI responses vary by provider — adapt as needed for chosen API
    // Common patterns: data.audio, data.video, data.links, etc.
    const audioUrl =
      data.audio?.url ??
      data.audio ??
      data.music?.url ??
      data.links?.audio ??
      null;
    const videoUrl =
      data.video?.url ??
      data.video ??
      data.links?.video ??
      data.downloadUrl ??
      data.url ??
      null;

    if (!audioUrl && !videoUrl) {
      console.error("[downloader] No download URLs in response:", data);
      return null;
    }

    return {
      audioUrl,
      videoUrl,
      platform,
      creatorHandle: creatorHandle ?? data.author?.username ?? data.creator ?? null,
      videoTitle: data.title ?? data.desc ?? null,
      thumbnailUrl: data.thumbnail ?? data.cover ?? data.thumbnailUrl ?? null,
      durationSeconds: data.duration ?? data.durationSeconds ?? null,
    };
  } catch (err) {
    console.error("[downloader] Failed:", err);
    return null;
  }
}
