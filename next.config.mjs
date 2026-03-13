/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["ffmpeg-static"],
    outputFileTracingIncludes: {
      "/api/grab": ["./node_modules/ffmpeg-static/**/*"],
      "/api/cron/enrichment-worker": ["./node_modules/ffmpeg-static/**/*"],
    },
  },
};

export default nextConfig;
