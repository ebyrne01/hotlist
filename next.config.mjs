/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "mosaic.scdn.co" },
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "image-cdn-ak.spotifycdn.com" },
      { protocol: "https", hostname: "image-cdn-fa.spotifycdn.com" },
    ],
  },
  experimental: {
    serverComponentsExternalPackages: ["ffmpeg-static"],
    outputFileTracingIncludes: {
      "/api/grab": ["./node_modules/ffmpeg-static/**/*"],
      "/api/cron/enrichment-worker": ["./node_modules/ffmpeg-static/**/*"],
    },
  },
};

export default nextConfig;
