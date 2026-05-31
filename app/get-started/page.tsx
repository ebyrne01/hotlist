import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, Sparkles, Upload, Users } from "lucide-react";

export const metadata: Metadata = {
  title: "Get Started — Hotlist",
  description:
    "Tell us what you love. Rate books, import from Goodreads, or follow your favorite BookTok creators.",
};

const PATHS = [
  {
    href: "/get-started/rate",
    eyebrow: "Recommended",
    icon: BookOpen,
    title: "Rate a few books",
    time: "2 minutes",
    description:
      "Pick favorites, hard passes, and books you are curious about. We will start shaping your taste profile right away.",
    payoff: "Best if you want the fastest path to better recs.",
    featured: true,
  },
  {
    href: "/get-started/import",
    eyebrow: "Power reader",
    icon: Upload,
    title: "Import Goodreads",
    time: "5 minutes",
    description:
      "Bring your shelves with you. We will match your history, map reader responses, and build a useful starting Hotlist.",
    payoff: "Best if Goodreads already knows your whole backstory.",
    featured: false,
  },
  {
    href: "/get-started/creators",
    eyebrow: "BookTok route",
    icon: Users,
    title: "Follow creators",
    time: "3 minutes",
    description:
      "Choose BookTok creators you trust and rate their top picks so your profile learns whose taste overlaps with yours.",
    payoff: "Best if your TBR comes from creator recommendations.",
    featured: false,
  },
];

export default function GetStartedPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-10 sm:py-16">
      <header className="mx-auto max-w-3xl text-center">
        <div className="mx-auto inline-flex rounded-full bg-fire/10 p-3 text-fire">
          <Sparkles size={22} aria-hidden="true" />
        </div>
        <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.24em] text-fire">
          Build your reader profile
        </p>
        <h1 className="mt-2 font-display text-4xl font-bold leading-tight text-ink sm:text-5xl">
          Tell Hotlist what you love, loathe, and keep meaning to read.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base font-body leading-7 text-muted-a11y">
          Give us a few favorites and hard passes. We will turn them into a
          sharper Reading DNA profile, better recommendations, and a first
          Hotlist you can actually use.
        </p>
      </header>

      <section className="mt-8 grid gap-3 rounded-2xl border border-aged-gold/30 bg-white/70 p-3 sm:grid-cols-3">
        <ProofPoint label="No auth wall" value="Browse first, save later" />
        <ProofPoint label="Mobile first" value="Tap your way through" />
        <ProofPoint label="Payoff" value="Ratings, spice, tropes, recs" />
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-[1.15fr_0.85fr_0.85fr]">
        {PATHS.map((path) => {
          const Icon = path.icon;
          return (
            <Link
              key={path.href}
              href={path.href}
              className={
                path.featured
                  ? "group relative overflow-hidden rounded-2xl border border-fire/30 bg-fire text-white p-5 shadow-lg shadow-fire/10 transition-transform hover:-translate-y-0.5"
                  : "group rounded-2xl border border-aged-gold/30 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-fire/30"
              }
            >
              {path.featured && (
                <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/15 to-transparent" />
              )}
              <div className="relative flex min-h-full flex-col">
                <div className="flex items-start justify-between gap-4">
                  <div
                    className={
                      path.featured
                        ? "rounded-full bg-white/15 p-3 text-white"
                        : "rounded-full bg-fire/10 p-3 text-fire"
                    }
                  >
                    <Icon size={22} aria-hidden="true" />
                  </div>
                  <span
                    className={
                      path.featured
                        ? "rounded-full bg-white/15 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/90"
                        : "rounded-full bg-cream px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-a11y"
                    }
                  >
                    {path.time}
                  </span>
                </div>
                <p
                  className={
                    path.featured
                      ? "mt-5 font-mono text-[10px] uppercase tracking-[0.2em] text-white/75"
                      : "mt-5 font-mono text-[10px] uppercase tracking-[0.2em] text-fire"
                  }
                >
                  {path.eyebrow}
                </p>
                <h2
                  className={
                    path.featured
                      ? "mt-1 font-display text-3xl font-bold text-white"
                      : "mt-1 font-display text-2xl font-bold text-ink group-hover:text-oxblood"
                  }
                >
                  {path.title}
                </h2>
                <p
                  className={
                    path.featured
                      ? "mt-3 text-sm font-body leading-6 text-white/85"
                      : "mt-3 text-sm font-body leading-6 text-muted-a11y"
                  }
                >
                  {path.description}
                </p>
                <p
                  className={
                    path.featured
                      ? "mt-4 text-xs font-mono leading-5 text-white/70"
                      : "mt-4 text-xs font-mono leading-5 text-muted"
                  }
                >
                  {path.payoff}
                </p>
                <span
                  className={
                    path.featured
                      ? "mt-6 inline-flex min-h-11 items-center justify-between rounded-lg bg-white px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-fire"
                      : "mt-6 inline-flex min-h-11 items-center justify-between rounded-lg border border-border bg-cream px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-muted-a11y transition-colors group-hover:border-fire/30 group-hover:text-fire"
                  }
                >
                  Start here
                  <ArrowRight size={14} aria-hidden="true" />
                </span>
              </div>
            </Link>
          );
        })}
      </section>

      <section className="mt-4 rounded-2xl border border-dashed border-aged-gold/40 bg-cream/50 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-lg font-bold text-ink/80">
              Snap a cover is coming later.
            </p>
            <p className="mt-1 text-sm font-body text-muted-a11y">
              Soon you will be able to take a photo of any book cover and look
              it up instantly.
            </p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            Coming soon
          </span>
        </div>
      </section>

      <footer className="mt-8 flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-center">
        <Link
          href="/reading/dna"
          className="inline-flex min-h-11 items-center rounded-full border border-fire/25 bg-fire/5 px-4 py-2 text-sm font-mono text-fire transition-colors hover:bg-fire/10"
        >
          Already know your taste? Take the Reading DNA quiz &rarr;
        </Link>
        <Link
          href="/reading/dna/results"
          className="text-sm font-body text-muted-a11y transition-colors hover:text-ink"
        >
          View your Reading DNA
        </Link>
      </footer>
    </div>
  );
}

function ProofPoint({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-cream px-4 py-3 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
        {label}
      </p>
      <p className="mt-1 text-sm font-body font-semibold text-ink">{value}</p>
    </div>
  );
}
