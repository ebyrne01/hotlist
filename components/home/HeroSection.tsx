"use client";

import { useEffect } from "react";
import SearchBar from "@/components/search/SearchBar";

interface HeroSectionProps {
  bookCount?: number;
  tropeCount?: number;
}

export default function HeroSection({ bookCount, tropeCount }: HeroSectionProps) {
  // Autofocus search on desktop only (avoid mobile keyboard pop-up)
  useEffect(() => {
    if (window.innerWidth >= 768) {
      document.getElementById("hero-search")?.focus();
    }
  }, []);

  // Round down to nearest hundred
  const displayBookCount = bookCount
    ? `${(Math.floor(bookCount / 100) * 100).toLocaleString()}+`
    : null;

  const displayTropeCount = tropeCount ?? 25;

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
          <SearchBar variant="hero" inputId="hero-search" />
        </div>

        <button
          onClick={() => document.getElementById("hero-search")?.focus()}
          className="mt-4 px-6 py-3 bg-fire text-cream font-mono text-sm font-semibold rounded-lg hover:bg-fire/90 transition-colors shadow-lg shadow-fire/20"
        >
          Find Your Next Read
        </button>

        {/* Stats bar */}
        {displayBookCount && (
          <p className="mt-4 text-sm font-mono text-cream/60 tracking-wide">
            {displayBookCount} books &middot; 3 rating sources &middot; {displayTropeCount} tropes &middot; 5 spice levels
          </p>
        )}

        <a
          href="#tropes"
          className="mt-3 text-xs font-mono text-cream/50 hover:text-cream/70 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fire rounded"
        >
          or browse by trope &darr;
        </a>
      </div>
    </section>
  );
}
