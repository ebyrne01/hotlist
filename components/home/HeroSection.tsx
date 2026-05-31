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
    <section className="relative surface-night overflow-hidden">
      <div className="absolute inset-0 surface-night-stars opacity-60" />
      <div className="absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-fire/20 blur-3xl" />

      <div className="relative max-w-3xl mx-auto px-4 py-14 sm:py-24 flex flex-col items-center text-center">
        <p className="editorial-rule w-full max-w-xs font-mono text-[10px] uppercase tracking-[0.28em] text-aged-gold">
          Romance intelligence
        </p>
        <h1 className="mt-5 font-display text-[2.65rem] sm:text-7xl font-bold text-cream leading-[0.98] tracking-[-0.045em]">
          Bring any book.
        </h1>
        <p className="font-display text-[2.1rem] sm:text-6xl font-semibold text-fire leading-[1.05] tracking-[-0.035em] mt-2">
          We&apos;ll tell you if it&apos;s hot.
        </p>
        <p className="mt-5 text-sm sm:text-base font-body text-cream/70 max-w-lg leading-relaxed">
          Ratings from Goodreads, Amazon, and Romance.io. Spice levels.
          Tropes. Everything you need to choose your next obsession.
        </p>

        <div className="mt-8 w-full max-w-xl">
          <SearchBar variant="hero" inputId="hero-search" />
        </div>

        <a
          href="#booktok-grab"
          className="mt-3 inline-flex min-h-11 items-center rounded px-2 text-[11px] font-mono uppercase tracking-[0.12em] text-aged-gold/80 transition-colors hover:text-aged-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fire"
        >
          or paste a BookTok link &darr;
        </a>
      </div>
      <div className="relative h-px bg-gradient-to-r from-transparent via-aged-gold/70 to-transparent" />
    </section>
  );
}
