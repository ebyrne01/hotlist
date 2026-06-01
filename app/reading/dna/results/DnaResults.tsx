"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { CANONICAL_SUBGENRES } from "@/lib/books/subgenre-classifier";

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
          Your Hotlist lens is ready.
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm font-body leading-6 text-muted-a11y sm:text-base">
          Use it to judge the books, shortlists, and BookTok finds you bring to Hotlist.
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
                Your lens
              </p>
              <p className="mt-2 font-body text-sm leading-7 text-ink sm:text-base">
                {dna.dnaDescription}
              </p>
            </section>
          )}

          {dna && (
            <section className="mt-6 grid gap-4 md:grid-cols-3">
              {dna.subgenrePreferences && dna.subgenrePreferences.length > 0 && (
                <DnaPanel title="Subgenres you want flagged">
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
                <DnaPanel title="Tropes that make a book pop">
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

              <DnaPanel title="Your hot zone">
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
                    How to use it
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-bold text-ink">
                    Bring us a book. We&apos;ll read it through this lens.
                  </h2>
                  <p className="mt-1 text-sm font-body text-muted-a11y">
                    DNA is not here to become another endless feed. It helps Hotlist
                    explain whether a book is your kind of hot.
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <LensAction
                  href="/search"
                  title="Search a book"
                  body="Check ratings, spice, tropes, and your personal fit."
                />
                <LensAction
                  href="/booktok"
                  title="Paste a BookTok"
                  body="Turn a video shortlist into books you can judge side by side."
                />
                <LensAction
                  href="/lists"
                  title="Compare a Hotlist"
                  body="Use your lens while deciding between several contenders."
                />
              </div>
            </section>
          )}

          {!dna && (
            <div className="mt-6 rounded-2xl border border-aged-gold/30 bg-white p-8 text-center shadow-sm">
              <p className="mx-auto max-w-sm text-sm font-body leading-6 text-muted-a11y">
                We&apos;ll use your preferences to judge whether the books you
                bring us are your kind of hot.
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
          Search a book
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

function LensAction({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-aged-gold/30 bg-cream p-4 transition-colors hover:border-fire/30 hover:bg-parchment"
    >
      <p className="font-display text-lg font-bold text-ink">{title}</p>
      <p className="mt-1 text-sm font-body leading-6 text-muted-a11y">
        {body}
      </p>
      <p className="mt-3 font-mono text-xs uppercase tracking-[0.14em] text-fire">
        Go &rarr;
      </p>
    </Link>
  );
}
