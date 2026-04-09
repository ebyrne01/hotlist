"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isVideoUrl } from "@/lib/utils/video-url";

export default function BookTokGrabCta() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    if (!isVideoUrl(trimmed)) {
      setError("Paste a TikTok, Instagram, or YouTube link");
      return;
    }

    setError(null);
    router.push(`/booktok?url=${encodeURIComponent(trimmed)}`);
  }

  return (
    <section
      id="booktok-grab"
      className="bg-gradient-to-r from-fire/10 to-fire/5 rounded-xl p-6 sm:p-8 scroll-mt-20"
    >
      <h2 className="font-display text-lg sm:text-xl font-bold text-ink text-center">
        Grab books from any BookTok video
      </h2>
      <p className="text-sm font-body text-muted text-center mt-1">
        Paste a link and we&apos;ll identify every book mentioned
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-4 flex gap-2 max-w-md mx-auto"
      >
        <input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          placeholder="Paste a TikTok, Reel, or Short..."
          className="flex-1 px-4 py-2.5 rounded-lg border border-border bg-white font-body text-sm text-ink placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-fire/30 focus:border-fire/40 transition-colors"
        />
        <button
          type="submit"
          className="px-4 py-2.5 rounded-lg bg-fire text-white font-mono text-sm font-semibold hover:bg-fire/90 transition-colors shrink-0"
        >
          Grab Books &rarr;
        </button>
      </form>

      {error && (
        <p className="text-xs text-status-error font-body text-center mt-2">
          {error}
        </p>
      )}

      <p className="text-xs font-mono text-muted/60 text-center mt-3">
        Works with TikTok &middot; Instagram Reels &middot; YouTube Shorts
      </p>
    </section>
  );
}
