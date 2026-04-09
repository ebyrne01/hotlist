/** Detect if a string looks like a video URL (TikTok, Instagram, YouTube, etc.) */
export function isVideoUrl(text: string): boolean {
  const trimmed = text.trim();
  return /^https?:\/\/.*(tiktok\.com|instagram\.com|youtube\.com|youtu\.be|reels|shorts)/i.test(trimmed);
}
