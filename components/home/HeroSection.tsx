"use client";

import SearchBar from "@/components/search/SearchBar";

export default function HeroSection() {
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

      <div className="relative max-w-2xl mx-auto px-4 py-20 sm:py-28 flex flex-col items-center text-center">
        <h1 className="font-display text-5xl sm:text-7xl font-bold text-cream italic">
          Hotlist 🔥
        </h1>
        <p className="mt-4 text-lg sm:text-xl font-body text-cream/70 max-w-md">
          Every rating. Every trope. One decision.
        </p>

        <div className="mt-8 w-full max-w-lg">
          <SearchBar variant="hero" />
        </div>

        <a
          href="#tropes"
          className="mt-6 text-sm font-mono text-cream/50 hover:text-cream/70 transition-colors"
        >
          or browse by trope &darr;
        </a>
      </div>
    </section>
  );
}
