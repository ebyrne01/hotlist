"use client";

import { useEffect } from "react";
import SearchBar from "@/components/search/SearchBar";

interface HeroSectionProps {
  bookCount?: number;
  tropeCount?: number;
  communitySpiceCount?: number;
}

export default function HeroSection({ bookCount, tropeCount, communitySpiceCount }: HeroSectionProps) {
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
        <p className="font-display text-2xl sm:text-3xl font-bold text-cream/80 italic">
          Hotlist 🔥
        </p>
        <h1 className="mt-3 font-display text-4xl sm:text-6xl font-bold text-cream italic leading-tight">
          Every rating. Every trope. One decision.
        </h1>
        <p className="mt-3 text-sm sm:text-base font-body text-cream/60 max-w-md">
          Search {displayBookCount ?? "thousands of"} romance and romantasy books
          to find spice levels, tropes, and ratings &mdash; all in one place.
        </p>

        <div className="mt-8 w-full max-w-lg">
          <SearchBar variant="hero" inputId="hero-search" />
        </div>

        {/* Stats bar */}
        {displayBookCount && (
          <p className="mt-4 text-sm font-mono text-cream/60 tracking-wide">
            {displayBookCount} books &middot;{" "}
            {communitySpiceCount && communitySpiceCount >= 50
              ? `${communitySpiceCount.toLocaleString()}+ community spice ratings`
              : "3 rating sources"}{" "}
            &middot; {displayTropeCount} tropes
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
