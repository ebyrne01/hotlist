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
      className="relative overflow-hidden surface-parchment border-y border-aged-gold/30 px-5 py-7 sm:px-10 sm:py-9 scroll-mt-20"
    >
      <div className="absolute -right-10 -top-16 h-40 w-40 rounded-full border border-aged-gold/20" />
      <div className="absolute -right-5 -top-10 h-28 w-28 rounded-full border border-aged-gold/20" />
      <div className="relative grid gap-5 sm:grid-cols-[1fr_minmax(320px,440px)] sm:items-center">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fire">
            From your feed to your shelf
          </p>
          <h2 className="mt-1 font-display text-2xl sm:text-3xl font-bold text-ink leading-tight">
            Caught a tempting BookTok?
          </h2>
          <p className="text-sm font-body text-muted-a11y mt-2 leading-relaxed">
            Paste the link. We&apos;ll pull out every title and bring the spice,
            tropes, and ratings with it.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="min-w-0"
        >
          <div className="flex min-w-0 flex-col gap-2 xs:flex-row sm:flex-row">
            <input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              placeholder="Paste a TikTok, Reel, or Short..."
              className="min-w-0 w-full flex-1 px-4 py-3 rounded-md border border-border bg-white/90 font-body text-sm text-ink placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-fire/30 focus:border-fire/40 transition-colors"
            />
            <button
              type="submit"
              className="px-5 py-3 rounded-md bg-oxblood text-white font-mono text-xs uppercase tracking-wide font-semibold hover:bg-blackberry transition-colors shrink-0"
            >
              Grab books &rarr;
            </button>
          </div>

          {error && (
            <p className="text-xs text-status-error font-body mt-2">
              {error}
            </p>
          )}

          <p className="text-[10px] font-mono uppercase tracking-wide text-muted-a11y/70 mt-3">
            TikTok &middot; Instagram Reels &middot; YouTube Shorts
          </p>
        </form>
      </div>
    </section>
  );
}
