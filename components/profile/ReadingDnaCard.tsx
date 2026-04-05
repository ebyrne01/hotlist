"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface DnaData {
  tropeAffinities: Record<string, number>;
  spicePreferred: number;
  signalCount: number;
  source: string;
  dnaDescription: string | null;
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
      <div className="bg-white border border-border rounded-lg p-6 mb-8 animate-pulse">
        <div className="h-5 bg-border/50 rounded w-40 mb-4" />
        <div className="h-4 bg-border/30 rounded w-60" />
      </div>
    );
  }

  // No DNA — show CTA
  if (!dna) {
    return (
      <div className="bg-white border border-border rounded-lg p-6 mb-8">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xl">&#x1f9ec;</span>
          <h2 className="font-display text-lg font-bold text-ink">
            Discover Your Reading DNA
          </h2>
        </div>
        <p className="text-sm font-body text-muted mb-4">
          Take a 30-second quiz to get personalized book recommendations.
        </p>
        <Link
          href="/get-started"
          className="inline-flex items-center justify-center px-4 py-2 bg-fire text-white text-sm font-mono rounded-lg hover:bg-fire/90 transition-colors"
        >
          Get Started
        </Link>
      </div>
    );
  }

  const topTropes = Object.entries(dna.tropeAffinities)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const spiceRounded = Math.round(dna.spicePreferred);
  const spiceLabel = SPICE_LABELS[spiceRounded] ?? "Medium";

  // Context line based on signal count
  let contextLine: string;
  if (dna.source === "quiz" && dna.signalCount <= 5) {
    contextLine = "Based on your quiz answers";
  } else if (dna.signalCount <= 15) {
    contextLine = `Based on your quiz + ${Math.max(0, dna.signalCount - 3)} rated books`;
  } else {
    contextLine = `Built from ${dna.signalCount} books you've rated and read`;
  }

  return (
    <div className="bg-white border border-border rounded-lg p-6 mb-8">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">&#x1f9ec;</span>
          <h2 className="font-display text-lg font-bold text-ink">
            Your Reading DNA
          </h2>
        </div>
        <Link
          href="/reading/dna"
          className="text-xs font-mono text-muted hover:text-fire transition-colors"
        >
          Retake Quiz
        </Link>
      </div>

      <p className="text-xs font-mono text-muted/70 mb-4">{contextLine}</p>

      {/* Top tropes */}
      {topTropes.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-mono text-muted uppercase tracking-wide mb-2">
            Top Tropes
          </p>
          <div className="flex flex-wrap gap-1.5">
            {topTropes.map(([slug, score]) => (
              <span
                key={slug}
                className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded-lg bg-fire/10 text-fire/90 border border-fire/15"
              >
                {tropeDisplayName(slug)}
                <span className="text-fire/50">
                  {Math.round(score * 100)}%
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Spice preference */}
      <div className="mb-4">
        <p className="text-xs font-mono text-muted uppercase tracking-wide mb-1">
          Spice Level
        </p>
        <p className="text-sm font-body text-ink">
          {"🌶️".repeat(spiceRounded)} {spiceLabel}
        </p>
      </div>

      {/* AI blurb */}
      {dna.dnaDescription && (
        <div className="bg-fire/5 border border-fire/10 rounded-lg px-4 py-3 mb-4">
          <p className="font-body text-sm text-ink leading-relaxed">
            {dna.dnaDescription}
          </p>
        </div>
      )}

      <Link
        href="/"
        className="text-xs font-mono text-fire hover:text-fire/80 transition-colors"
      >
        See your recommendations &rarr;
      </Link>
    </div>
  );
}
