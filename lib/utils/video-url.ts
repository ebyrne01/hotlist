export type VideoPlatform = "tiktok" | "instagram" | "youtube" | "unknown";

const SUPPORTED_VIDEO_HOSTS: Array<{ platform: Exclude<VideoPlatform, "unknown">; hosts: string[] }> = [
  {
    platform: "tiktok",
    hosts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
  },
  {
    platform: "instagram",
    hosts: ["instagram.com"],
  },
  {
    platform: "youtube",
    hosts: ["youtube.com", "youtu.be"],
  },
];

function matchesHost(hostname: string, allowedHost: string): boolean {
  return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`);
}

export function getVideoPlatform(text: string): VideoPlatform {
  try {
    const url = new URL(text.trim());
    if (!["http:", "https:"].includes(url.protocol)) return "unknown";

    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const match = SUPPORTED_VIDEO_HOSTS.find(({ hosts }) =>
      hosts.some((host) => matchesHost(hostname, host))
    );

    return match?.platform ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Detect if a string is a supported video URL. */
export function isVideoUrl(text: string): boolean {
  return getVideoPlatform(text) !== "unknown";
}
