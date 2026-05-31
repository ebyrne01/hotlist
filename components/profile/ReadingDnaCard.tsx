"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CANONICAL_SUBGENRES } from "@/lib/books/subgenre-classifier";

const SUBGENRE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  CANONICAL_SUBGENRES.map((sg) => [sg.slug, sg.label])
);

interface DnaData {
  tropeAffinities: Record<string, number>;
  spicePreferred: number;
  spiceTolerance: number;
  signalCount: number;
  source: string;
  dnaDescription: string | null;
  subgenrePreferences?: string[];
}

const SPICE_LABELS: Record<number, string> = {
  1: "Sweet",
  2: "Mild",
  3: "Medium",
  4: "Hot",
  5: "Scorching",
};

function tropeDisplayName(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function ReadingDnaCard() {
  const [dna, setDna] = useState<DnaData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/reading-dna/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.dna) setDna(data.dna);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border border-aged-gold/30 bg-white p-6 shadow-sm animate-pulse">
        <div className="mb-4 h-3 w-28 rounded bg-aged-gold/20" />
        <div className="mb-4 h-6 w-48 rounded bg-border/50" />
        <div className="h-4 w-64 max-w-full rounded bg-border/30" />
      </div>
    );
  }

  // No DNA — show CTA
  if (!dna) {
    return (
      <div className="rounded-2xl border border-aged-gold/30 bg-white p-6 shadow-sm">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-aged-gold">
          Reading DNA
        </p>
        <h2 className="mt-2 font-display text-2xl font-bold text-ink">
          Build your taste profile.
        </h2>
        <p className="mt-2 text-sm font-body leading-6 text-muted-a11y">
          Take a quick test so Hotlist can learn your preferred tropes, subgenres, and spice range.
        </p>
        <Link
          href="/get-started"
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-fire px-4 py-2 text-sm font-mono text-white transition-colors hover:bg-fire/90"
        >
          Get Started
        </Link>
      </div>
    );
  }

  const topTropes = Object.entries(dna.tropeAffinities)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const spicePref = dna.spicePreferred;
  const spiceTol = dna.spiceTolerance ?? 0;
  const spiceMin = Math.max(1, Math.round(spicePref - spiceTol));
  const spiceMax = Math.min(5, Math.round(spicePref + spiceTol));
  const isSpiceRange = spiceMin < spiceMax;
  const spiceLabel = isSpiceRange
    ? `${SPICE_LABELS[spiceMin]} to ${SPICE_LABELS[spiceMax]}`
    : SPICE_LABELS[Math.round(spicePref)] ?? "Medium";

  // Context line based on signal count
  let contextLine: string;
  if (dna.source === "quiz" && dna.signalCount <= 5) {
    contextLine = "Based on your test answers";
  } else if (dna.signalCount <= 15) {
    contextLine = `Based on your test + ${Math.max(0, dna.signalCount - 3)} rated books`;
  } else {
    contextLine = `Built from ${dna.signalCount} books you've rated and read`;
  }

  return (
    <div className="rounded-2xl border border-aged-gold/30 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-aged-gold">
            Reading DNA
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold text-ink">
            Your Reading DNA
          </h2>
        </div>
        <Link
          href="/reading/dna"
          className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-mono text-muted-a11y transition-colors hover:bg-parchment hover:text-fire"
        >
          Retake Test
        </Link>
      </div>

      <p className="mb-5 rounded-xl border border-aged-gold/25 bg-cream/70 px-3 py-2 text-xs font-mono text-muted-a11y">
        {contextLine}
      </p>

      {/* Subgenre preferences */}
      {dna.subgenrePreferences && dna.subgenrePreferences.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-mono uppercase tracking-wide text-muted-a11y">
            Subgenres
          </p>
          <div className="flex flex-wrap gap-1.5">
            {dna.subgenrePreferences.map((slug) => (
              <span
                key={slug}
                className="inline-flex min-h-8 items-center rounded-lg border border-fire/15 bg-fire/10 px-2.5 py-1 text-xs font-mono text-fire/90"
              >
                {SUBGENRE_LABEL_MAP[slug] ?? slug}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Top tropes */}
      {topTropes.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-mono uppercase tracking-wide text-muted-a11y">
            Top Tropes
          </p>
          <div className="flex flex-wrap gap-1.5">
            {topTropes.map(([slug, score]) => (
              <span
                key={slug}
                className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-aged-gold/30 bg-parchment px-2.5 py-1 text-xs font-mono text-ink"
              >
                {tropeDisplayName(slug)}
                <span className="text-fire/70">
                  {Math.round(score * 100)}%
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Spice preference */}
      <div className="mb-4">
        <p className="mb-1 text-xs font-mono uppercase tracking-wide text-muted-a11y">
          Spice Level
        </p>
        <p className="text-sm font-body text-ink">
          {isSpiceRange
            ? `${"🌶️".repeat(spiceMin)} – ${"🌶️".repeat(spiceMax)} ${spiceLabel}`
            : `${"🌶️".repeat(Math.round(spicePref))} ${spiceLabel}`}
        </p>
      </div>

      {/* AI blurb */}
      {dna.dnaDescription && (
        <div className="mb-5 rounded-xl border border-fire/10 bg-fire/5 px-4 py-3">
          <p className="font-body text-sm text-ink leading-relaxed">
            {dna.dnaDescription}
          </p>
        </div>
      )}

      <Link
        href="/"
        className="inline-flex min-h-11 items-center justify-center rounded-lg bg-fire px-4 py-2 text-sm font-mono text-white transition-colors hover:bg-fire/90"
      >
        See your recommendations &rarr;
      </Link>
    </div>
  );
}
