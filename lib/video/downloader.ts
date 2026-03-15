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
  /** For photo/carousel posts: direct URLs to each slide image */
  imageUrls: string[];
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
 *
 * Supports "social-download-all-in-one" API (POST /v1/social/autolink).
 * Response contains a `medias` array with video/audio download links.
 *
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
  const apiHost =
    process.env.RAPIDAPI_VIDEO_HOST ??
    "social-download-all-in-one.p.rapidapi.com";

  if (!apiKey) {
    console.error("[downloader] Missing RAPIDAPI_KEY");
    return null;
  }

  const creatorHandle = extractCreatorHandle(url, platform);

  try {
    const response = await fetch(
      `https://${apiHost}/v1/social/autolink`,
      {
        method: "POST",
        headers: {
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": apiHost,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
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

    // "social-download-all-in-one" returns:
    // { url, source, title, thumbnail, medias: [{ quality, type, url, extension }] }
    const medias: Array<{
      quality?: string;
      type?: string;
      url?: string;
      extension?: string;
    }> = data.medias ?? [];

    const audioMedia = medias.find((m) => m.type === "audio");
    const videoMedia =
      medias.find((m) => m.type === "video" && m.quality === "hd_no_watermark") ??
      medias.find((m) => m.type === "video" && m.quality === "hd") ??
      medias.find((m) => m.type === "video" && m.quality === "no_watermark") ??
      medias.find((m) => m.type === "video" && !m.quality?.includes("watermark")) ??
      medias.find((m) => m.type === "video");

    // Photo/carousel posts: collect all image URLs
    const imageUrls = medias
      .filter((m) => m.type === "image" && m.url)
      .map((m) => m.url as string);

    const audioUrl = audioMedia?.url ?? null;
    const videoUrl = videoMedia?.url ?? null;

    if (!audioUrl && !videoUrl && imageUrls.length === 0) {
      console.error("[downloader] No download URLs in response:", JSON.stringify(data).slice(0, 500));
      return null;
    }

    if (imageUrls.length > 0) {
      console.log(`[downloader] Photo/carousel post detected: ${imageUrls.length} images`);
    }

    return {
      audioUrl,
      videoUrl,
      platform,
      creatorHandle:
        creatorHandle ??
        (data.unique_id ? `@${data.unique_id}` : null) ??
        null,
      videoTitle: data.title ?? null,
      thumbnailUrl: data.thumbnail ?? null,
      durationSeconds:
        data.duration != null ? Math.round(data.duration / 1000) : null,
      imageUrls,
    };
  } catch (err) {
    console.error("[downloader] Failed:", err);
    return null;
  }
}
