"use client";

import { useEffect, useState, type ReactNode } from "react";
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
          if (data.dna) {
            setForYouLoading(true);
            fetch("/api/homepage/for-you")
              .then((r) => (r.ok ? r.json() : { books: [] }))
              .then((d) => setForYouBooks(d.books ?? []))
              .catch(() => {})
              .finally(() => setForYouLoading(false));
          }
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
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <header className="surface-parchment -mx-4 -mt-8 border-b border-aged-gold/30 px-4 py-10 text-center sm:mx-0 sm:mt-0 sm:rounded-3xl sm:border sm:px-8 sm:py-12">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-aged-gold">
          Reading DNA
        </p>
        <h1 className="mx-auto mt-2 max-w-2xl font-display text-4xl font-bold leading-tight text-ink sm:text-5xl">
          Your reading DNA is ready.
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm font-body leading-6 text-muted-a11y sm:text-base">
          A sharper little map of what tends to make a book irresistible to you.
        </p>
      </header>

      {loading ? (
        <div className="mt-6 rounded-2xl border border-aged-gold/30 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-body text-muted-a11y">Loading your profile...</p>
        </div>
      ) : (
        <>
          {dna?.dnaDescription && (
            <section className="mt-6 rounded-2xl border border-fire/10 bg-fire/5 px-5 py-5 shadow-sm sm:px-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fire/70">
                Your profile
              </p>
              <p className="mt-2 font-body text-sm leading-7 text-ink sm:text-base">
                {dna.dnaDescription}
              </p>
            </section>
          )}

          {dna && (
            <section className="mt-6 grid gap-4 md:grid-cols-3">
              {dna.subgenrePreferences && dna.subgenrePreferences.length > 0 && (
                <DnaPanel title="Your subgenres">
                  <div className="flex flex-wrap gap-2">
                    {dna.subgenrePreferences.map((slug) => (
                      <span
                        key={slug}
                        className="inline-flex min-h-8 items-center rounded-lg border border-fire/15 bg-fire/10 px-2.5 py-1 text-xs font-mono text-fire/90"
                      >
                        {SUBGENRE_LABEL_MAP[slug] ?? slug}
                      </span>
                    ))}
                  </div>
                </DnaPanel>
              )}

              {topTropes.length > 0 && (
                <DnaPanel title="Top tropes">
                  <div className="flex flex-wrap gap-2">
                    {topTropes.map(([slug, score]) => (
                      <span
                        key={slug}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-aged-gold/30 bg-parchment px-2.5 py-1 text-xs font-mono text-ink"
                      >
                        {tropeNames[slug] ?? slug.replace(/-/g, " ")}
                        <span className="text-fire/70">
                          {Math.round(score * 100)}%
                        </span>
                      </span>
                    ))}
                  </div>
                </DnaPanel>
              )}

              <DnaPanel title="Spice range">
                <p className="text-sm font-body leading-6 text-ink">
                  {isRange
                    ? `${"🌶️".repeat(spiceMin)} – ${"🌶️".repeat(spiceMax)} ${spiceLabel}`
                    : `${"🌶️".repeat(Math.round(spicePref))} ${spiceLabel}`}
                </p>
              </DnaPanel>
            </section>
          )}

          {dna && (
            <section className="mt-6 rounded-2xl border border-aged-gold/30 bg-white p-5 shadow-sm sm:p-6">
              <div className="sm:flex sm:items-end sm:justify-between sm:gap-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-aged-gold">
                    Taste check
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-bold text-ink">
                    Does this sound like you?
                  </h2>
                  <p className="mt-1 text-sm font-body text-muted-a11y">
                    A few recommendations based on the profile above.
                  </p>
                </div>
              </div>
              <div className="mt-4 text-left">
                {forYouLoading ? (
                  <BookRow books={[]} loading />
                ) : forYouBooks.length > 0 ? (
                  <BookRow books={forYouBooks} />
                ) : (
                  <p className="py-4 text-center text-sm font-body text-muted-a11y">
                    We&apos;re still building your recommendations — check the
                    homepage soon!
                  </p>
                )}
              </div>
            </section>
          )}

          {!dna && (
            <div className="mt-6 rounded-2xl border border-aged-gold/30 bg-white p-8 text-center shadow-sm">
              <p className="mx-auto max-w-sm text-sm font-body leading-6 text-muted-a11y">
                We&apos;ll use your preferences to recommend books you&apos;ll
                love. Check out your personalized picks on the homepage.
              </p>
            </div>
          )}
        </>
      )}

      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link
          href="/"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-fire px-6 font-mono text-sm text-white transition-colors hover:bg-fire/90 sm:w-auto"
        >
          Yes! Show me more
        </Link>
        <Link
          href="/reading/dna"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-aged-gold/30 bg-white px-4 font-mono text-sm text-muted-a11y transition-colors hover:border-fire/30 hover:text-fire sm:w-auto"
        >
          Not quite, retake
        </Link>
      </div>
    </div>
  );
}

function DnaPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-aged-gold/30 bg-white p-5 shadow-sm">
      <p className="mb-3 text-xs font-mono uppercase tracking-wide text-muted-a11y">
        {title}
      </p>
      {children}
    </div>
  );
}
