"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CANONICAL_SUBGENRES } from "@/lib/books/subgenre-classifier";
import BookRow from "@/components/books/BookRow";
import type { BookDetail } from "@/lib/types";

const SUBGENRE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  CANONICAL_SUBGENRES.map((sg) => [sg.slug, sg.label])
);

interface DnaData {
  tropeAffinities: Record<string, number>;
  spicePreferred: number;
  spiceTolerance: number;
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

export default function DnaResults() {
  const [dna, setDna] = useState<DnaData | null>(null);
  const [tropeNames, setTropeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [forYouBooks, setForYouBooks] = useState<BookDetail[]>([]);
  const [forYouLoading, setForYouLoading] = useState(false);

  useEffect(() => {
    async function fetchDna() {
      try {
        const res = await fetch("/api/reading-dna/me");
        if (res.ok) {
          const data = await res.json();
          setDna(data.dna);

          // Fetch trope display names for the top affinities
          if (data.dna?.tropeAffinities) {
            const slugs = Object.keys(data.dna.tropeAffinities).slice(0, 8);
            if (slugs.length > 0) {
              const tropeRes = await fetch(
                `/api/tropes?slugs=${slugs.join(",")}`
              );
              if (tropeRes.ok) {
                const tropeData = await tropeRes.json();
                const nameMap: Record<string, string> = {};
                for (const t of tropeData.tropes ?? []) {
                  nameMap[t.slug] = t.name;
                }
                setTropeNames(nameMap);
              }
            }
          }

          // Fetch For You recommendations (async, non-blocking)
          setForYouLoading(true);
          fetch("/api/homepage/for-you")
            .then((r) => (r.ok ? r.json() : { books: [] }))
            .then((d) => setForYouBooks(d.books ?? []))
            .catch(() => {})
            .finally(() => setForYouLoading(false));
        }
      } catch {
        // Fail gracefully — show static fallback
      } finally {
        setLoading(false);
      }
    }
    fetchDna();
  }, []);

  // Top tropes sorted by affinity
  const topTropes = dna?.tropeAffinities
    ? Object.entries(dna.tropeAffinities)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 6)
    : [];

  // Derive spice range from preferred + tolerance
  const spicePref = dna?.spicePreferred ?? 3;
  const spiceTol = dna?.spiceTolerance ?? 0;
  const spiceMin = Math.max(1, Math.round(spicePref - spiceTol));
  const spiceMax = Math.min(5, Math.round(spicePref + spiceTol));
  const isRange = spiceMin < spiceMax;
  const spiceLabel = isRange
    ? `${SPICE_LABELS[spiceMin]} to ${SPICE_LABELS[spiceMax]}`
    : SPICE_LABELS[Math.round(spicePref)] ?? "Medium";

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="text-5xl mb-4">🧬</div>
      <h1 className="font-display text-3xl font-bold text-ink">
        Your Reading DNA is ready!
      </h1>

      {loading ? (
        <p className="text-sm font-body text-muted mt-4">Loading your profile...</p>
      ) : (
        <>
          {/* AI-generated blurb */}
          {dna?.dnaDescription && (
            <div className="mt-6 bg-fire/5 border border-fire/10 rounded-xl px-5 py-4 text-left">
              <p className="font-body text-ink text-sm leading-relaxed">
                {dna.dnaDescription}
              </p>
            </div>
          )}

          {/* Subgenre preferences */}
          {dna?.subgenrePreferences && dna.subgenrePreferences.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-mono text-muted uppercase tracking-wide mb-3">
                Your subgenres
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {dna.subgenrePreferences.map((slug) => (
                  <span
                    key={slug}
                    className="inline-flex items-center text-xs font-mono px-2.5 py-1.5 rounded-lg bg-fire/10 text-fire/90 border border-fire/15"
                  >
                    {SUBGENRE_LABEL_MAP[slug] ?? slug}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Trope affinities */}
          {topTropes.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-mono text-muted uppercase tracking-wide mb-3">
                Your top tropes
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {topTropes.map(([slug, score]) => (
                  <span
                    key={slug}
                    className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1.5 rounded-lg bg-fire/10 text-fire/90 border border-fire/15"
                  >
                    {tropeNames[slug] ?? slug.replace(/-/g, " ")}
                    <span className="text-fire/50">
                      {Math.round(score * 100)}%
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Spice preference */}
          {dna && (
            <div className="mt-5">
              <p className="text-xs font-mono text-muted uppercase tracking-wide mb-1">
                Spice level
              </p>
              <p className="text-sm font-body text-ink">
                {isRange
                  ? `${"🌶️".repeat(spiceMin)} – ${"🌶️".repeat(spiceMax)} ${spiceLabel}`
                  : `${"🌶️".repeat(Math.round(spicePref))} ${spiceLabel}`}
              </p>
            </div>
          )}

          {/* Recommendation preview */}
          {dna && (
            <>
              <div className="mt-10 mb-6 border-t border-fire/10" />
              <h2 className="font-display text-xl font-bold text-ink">
                Does this sound like you?
              </h2>
              <p className="text-sm font-body text-muted mt-1">
                Here are some books we think you&apos;ll love
              </p>
              <div className="text-left mt-4">
                {forYouLoading ? (
                  <BookRow books={[]} loading />
                ) : forYouBooks.length > 0 ? (
                  <BookRow books={forYouBooks} />
                ) : (
                  <p className="text-sm font-body text-muted/70 py-4 text-center">
                    We&apos;re still building your recommendations — check the
                    homepage soon!
                  </p>
                )}
              </div>
            </>
          )}

          {/* Fallback when no DNA loaded */}
          {!dna && (
            <p className="text-sm font-body text-muted mt-3 max-w-sm mx-auto">
              We&apos;ll use your preferences to recommend books you&apos;ll
              love. Check out your personalized picks on the homepage.
            </p>
          )}
        </>
      )}

      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-lg font-body font-medium bg-fire text-white hover:bg-fire/90 px-6 min-h-[44px] transition-colors"
        >
          Yes! Show me more
        </Link>
        <Link
          href="/reading/dna"
          className="inline-flex items-center justify-center rounded-lg font-body font-medium text-muted hover:text-ink hover:bg-ink/5 px-4 min-h-[44px] transition-colors"
        >
          Not quite — retake
        </Link>
      </div>
    </div>
  );
}
