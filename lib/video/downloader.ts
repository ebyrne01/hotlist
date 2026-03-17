/**
 * Video Downloader — RapidAPI integration
 *
 * Platform-specific downloaders for reliability, with all-in-one fallback.
 *
 * TikTok: specialized API (RAPIDAPI_TIKTOK_HOST) → all-in-one fallback
 * Instagram/YouTube: all-in-one only (for now)
 *
 * The specialized TikTok downloader connects directly to TikTok's backend
 * and returns full-length videos, avoiding the truncation issues common
 * with all-in-one downloaders' re-encoded no-watermark versions.
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
  /** All available video URLs in priority order (for fallback if primary is truncated) */
  allVideoUrls: string[];
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
 * Main entry point — download video/audio URL via RapidAPI.
 *
 * For TikTok: tries specialized downloader first, then falls back to all-in-one.
 * For other platforms: uses all-in-one directly.
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
  if (!apiKey) {
    console.error("[downloader] Missing RAPIDAPI_KEY");
    return null;
  }

  // TikTok: try specialized downloader first
  if (platform === "tiktok") {
    const tiktokHost = process.env.RAPIDAPI_TIKTOK_HOST;
    if (tiktokHost) {
      console.log(`[downloader] Trying specialized TikTok API: ${tiktokHost}`);
      const result = await downloadViaTikTokApi(url, apiKey, tiktokHost);
      if (result) {
        console.log(`[downloader] Specialized TikTok API succeeded: video=${!!result.videoUrl}, audio=${!!result.audioUrl}, duration=${result.durationSeconds}s`);
        return result;
      }
      console.warn("[downloader] Specialized TikTok API failed, falling back to all-in-one");
    }
  }

  // All platforms: all-in-one downloader
  return downloadViaAllInOne(url, platform, apiKey);
}

/**
 * Specialized TikTok downloader.
 *
 * Supports two common API patterns:
 * - GET /getVideo?url=... (tikwm-style APIs)
 * - GET /?url=... (7scorp-style APIs)
 *
 * Both return JSON with video download URLs. The response format varies
 * but we handle the common patterns.
 */
async function downloadViaTikTokApi(
  url: string,
  apiKey: string,
  apiHost: string
): Promise<VideoDownloadResult | null> {
  const platform = "tiktok" as const;
  const creatorHandle = extractCreatorHandle(url, platform);

  try {
    // Try the known endpoint patterns for this API
    const endpoints = [
      `https://${apiHost}/vid/index?url=${encodeURIComponent(url)}`,
      `https://${apiHost}/getVideo?url=${encodeURIComponent(url)}`,
      `https://${apiHost}/?url=${encodeURIComponent(url)}`,
    ];

    let data: Record<string, unknown> | null = null;

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            "x-rapidapi-key": apiKey,
            "x-rapidapi-host": apiHost,
          },
        });

        if (response.ok) {
          data = await response.json();
          console.log(`[downloader] TikTok API responded from: ${endpoint.split("?")[0]}`);
          break;
        }

        // 404 means wrong endpoint, try next
        if (response.status === 404) continue;

        // Other errors: log and try next
        console.warn(`[downloader] TikTok API ${response.status} from ${endpoint.split("?")[0]}`);
      } catch {
        continue;
      }
    }

    if (!data) return null;

    // Parse the response — handle common TikTok downloader formats
    return parseTikTokResponse(data, platform, creatorHandle);
  } catch (err) {
    console.error("[downloader] TikTok API failed:", err);
    return null;
  }
}

/**
 * Parse TikTok API response — handles multiple common formats:
 *
 * Format A (tikwm-style): { data: { play, hdplay, wmplay, music, title, duration, ... } }
 * Format B (7scorp-style): { video: ["url1", "url2"], audio: "url", title, ... }
 * Format C (flat): { video_url, audio_url, title, duration, ... }
 */
function parseTikTokResponse(
  raw: Record<string, unknown>,
  platform: "tiktok",
  creatorHandle: string | null
): VideoDownloadResult | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = raw as any;

  let videoUrl: string | null = null;
  let audioUrl: string | null = null;
  let title: string | null = null;
  let thumbnail: string | null = null;
  let durationSeconds: number | null = null;
  const allVideoUrls: string[] = [];
  const imageUrls: string[] = [];

  // Format A: { data: { play, hdplay, wmplay, music, ... } }
  if (data.data && typeof data.data === "object") {
    const d = data.data;
    // Prefer hdplay (HD no watermark) > play (SD no watermark) > wmplay (watermarked)
    videoUrl = d.hdplay || d.play || d.wmplay || null;
    if (d.hdplay) allVideoUrls.push(d.hdplay);
    if (d.play && d.play !== d.hdplay) allVideoUrls.push(d.play);
    if (d.wmplay) allVideoUrls.push(d.wmplay);
    audioUrl = d.music || d.music_info?.play || null;
    title = d.title || null;
    thumbnail = d.origin_cover || d.cover || null;
    durationSeconds = d.duration != null ? Math.round(Number(d.duration)) : null;
    // Carousel/slideshow images
    if (Array.isArray(d.images)) {
      for (const img of d.images) {
        if (typeof img === "string") imageUrls.push(img);
        else if (img?.url) imageUrls.push(img.url);
      }
    }
  }
  // Format B (7scorp-style): { video: ["url"], music: ["url"], cover: ["url"], author: ["name"], ... }
  else if (data.video || data.video_url || data.videoUrl) {
    // video field: array of URLs or single string
    const videos = data.video;
    if (Array.isArray(videos)) {
      for (const v of videos) {
        if (typeof v === "string") allVideoUrls.push(v);
        else if (v?.url) allVideoUrls.push(v.url);
      }
      videoUrl = allVideoUrls[0] ?? null;
    } else {
      videoUrl = (typeof videos === "string" ? videos : null)
        ?? data.video_url ?? data.videoUrl ?? null;
      if (videoUrl) allVideoUrls.push(videoUrl);
    }
    // OriginalWatermarkedVideo as fallback (full-length, watermarked)
    if (Array.isArray(data.OriginalWatermarkedVideo)) {
      for (const v of data.OriginalWatermarkedVideo) {
        if (typeof v === "string" && !allVideoUrls.includes(v)) allVideoUrls.push(v);
      }
    }
    // music/audio: may be array or string
    const music = data.music ?? data.audio ?? data.audio_url ?? data.audioUrl ?? null;
    audioUrl = Array.isArray(music) ? (music[0] ?? null) : music;
    // description/title
    const desc = data.description ?? data.title ?? data.desc ?? null;
    title = Array.isArray(desc) ? (desc[0] ?? null) : desc;
    // thumbnail/cover: may be array or string
    const cover = data.cover ?? data.thumbnail ?? data.origin_cover ?? null;
    thumbnail = Array.isArray(cover) ? (cover[0] ?? null) : cover;
    durationSeconds = data.duration != null ? Math.round(Number(data.duration)) : null;
    // Carousel/slideshow images from 7scorp format
    if (Array.isArray(data.images) && data.images.length > 0) {
      for (const img of data.images) {
        if (typeof img === "string") imageUrls.push(img);
        else if (img?.url) imageUrls.push(img.url);
      }
    }
  }
  // Format C: response has a nested result
  else if (data.result && typeof data.result === "object") {
    return parseTikTokResponse(data.result as Record<string, unknown>, platform, creatorHandle);
  }

  if (!videoUrl && !audioUrl && imageUrls.length === 0) {
    console.warn("[downloader] TikTok API: no usable URLs in response, keys:", Object.keys(data).join(", "));
    return null;
  }

  // Extract handle from response if available
  // 7scorp returns author as ["username"], tikwm returns author.unique_id
  const authorField = data.author ?? data.data?.author;
  const responseHandle = Array.isArray(authorField) ? (authorField[0] ?? null)
    : (authorField?.unique_id ?? data.unique_id ?? null);

  console.log(`[downloader] TikTok API parsed: ${allVideoUrls.length} video URLs, duration=${durationSeconds}s, images=${imageUrls.length}`);

  return {
    audioUrl,
    videoUrl,
    platform,
    creatorHandle: creatorHandle ?? (responseHandle ? `@${responseHandle}` : null),
    videoTitle: title,
    thumbnailUrl: thumbnail,
    durationSeconds,
    imageUrls,
    allVideoUrls,
  };
}

/**
 * All-in-one downloader (current approach).
 *
 * Uses "social-download-all-in-one" API (POST /v1/social/autolink).
 * Works for TikTok, Instagram, YouTube.
 */
async function downloadViaAllInOne(
  url: string,
  platform: "tiktok" | "instagram" | "youtube",
  apiKey: string
): Promise<VideoDownloadResult | null> {
  const apiHost =
    process.env.RAPIDAPI_VIDEO_HOST ??
    "social-download-all-in-one.p.rapidapi.com";

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
        `[downloader] All-in-one API returned ${response.status}:`,
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

    // Collect ALL video URLs for fallback (some no-watermark versions are truncated)
    const allVideoUrls = medias
      .filter((m) => m.type === "video" && m.url)
      .map((m) => m.url as string);

    if (!audioUrl && !videoUrl && imageUrls.length === 0) {
      console.error("[downloader] No download URLs in response:", JSON.stringify(data).slice(0, 500));
      return null;
    }

    if (imageUrls.length > 0) {
      console.log(`[downloader] Photo/carousel post detected: ${imageUrls.length} images`);
    }

    console.log(`[downloader] All-in-one: ${allVideoUrls.length} video URLs, qualities: ${medias.filter(m => m.type === "video").map(m => m.quality).join(", ")}`);

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
      allVideoUrls,
    };
  } catch (err) {
    console.error("[downloader] All-in-one failed:", err);
    return null;
  }
}
