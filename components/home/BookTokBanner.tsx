"use client";

import Link from "next/link";

export default function BookTokBanner() {
  return (
    <section className="max-w-6xl mx-auto px-4 py-6">
      <Link
        href="/booktok"
        className="block bg-gradient-to-r from-fire/10 to-fire/5 border border-fire/20 rounded-xl px-5 py-4 sm:px-6 sm:py-5 hover:border-fire/40 transition-colors group"
      >
        <div className="flex items-center gap-3 sm:gap-4">
          <span className="text-2xl sm:text-3xl shrink-0">📹</span>
          <div className="flex-1 min-w-0">
            <p className="font-display text-base sm:text-lg font-bold text-ink">
              Saw a book rec on BookTok?
            </p>
            <p className="text-xs sm:text-sm font-body text-muted mt-0.5">
              Paste any TikTok, Reels, or YouTube link and we&apos;ll pull every book mentioned.
            </p>
          </div>
          <span className="text-fire font-mono text-sm font-medium shrink-0 group-hover:translate-x-0.5 transition-transform">
            Try it &rarr;
          </span>
        </div>
      </Link>
    </section>
  );
}
