"use client";

import { useEffect } from "react";
import SearchBar from "@/components/search/SearchBar";

export default function HeroSection() {
  // Autofocus search on desktop only (avoid mobile keyboard pop-up)
  useEffect(() => {
    if (window.innerWidth >= 768) {
      document.getElementById("hero-search")?.focus();
    }
  }, []);

  return (
    <section className="relative bg-ink overflow-hidden">
      {/* Subtle radial gradient */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, #d4430e 0%, transparent 60%)",
        }}
      />

      <div className="relative max-w-2xl mx-auto px-4 py-12 sm:py-20 flex flex-col items-center text-center">
        <p className="font-display text-2xl sm:text-3xl font-bold text-cream/80 italic">
          Hotlist 🔥
        </p>
        <h1 className="mt-3 font-display text-4xl sm:text-6xl font-bold text-cream italic leading-tight">
          Bring any book.
        </h1>
        <p className="font-display text-3xl sm:text-5xl font-bold text-fire italic leading-tight mt-1">
          We&apos;ll tell you if it&apos;s hot.
        </p>
        <p className="mt-3 text-sm sm:text-base font-body text-cream/60 max-w-md">
          Ratings from Goodreads, Amazon, and Romance.io. Spice levels.
          Tropes. Everything you need to decide what to read next.
        </p>

        <div className="mt-8 w-full max-w-lg">
          <SearchBar variant="hero" inputId="hero-search" />
        </div>

        <a
          href="#booktok-grab"
          className="mt-3 text-xs font-mono text-cream/50 hover:text-cream/70 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fire rounded"
        >
          or paste a BookTok link &darr;
        </a>
      </div>
    </section>
  );
}
