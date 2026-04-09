import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Get Started — Hotlist",
  description:
    "Tell us what you love. Rate books, import from Goodreads, or follow your favorite BookTok creators.",
};

const PATHS = [
  {
    href: "/get-started/rate",
    icon: "📖",
    title: "Rate some books you love",
    time: "2 minutes",
    description:
      "Quick picks to start your taste profile. We'll build your first Hotlist from your favorites.",
  },
  {
    href: "/get-started/import",
    icon: "📚",
    title: "Import from Goodreads",
    time: "5 minutes",
    description:
      "Upload your Goodreads export and we'll add spice levels, tropes, and personalized picks.",
  },
  {
    href: "/get-started/creators",
    icon: "👀",
    title: "Follow your favorite creators",
    time: "3 minutes",
    description:
      "Tell us who you follow on BookTok and we'll build your first Hotlist from their picks.",
  },
];

export default function GetStartedPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
      <div className="text-center mb-10">
        <h1 className="font-display text-3xl font-bold text-ink">
          Tell us what you love.
        </h1>
        <p className="font-display text-xl text-muted mt-1 italic">
          We&apos;ll build your world.
        </p>
      </div>

      <div className="flex flex-col gap-4 max-w-md mx-auto">
        {PATHS.map((path) => (
          <Link
            key={path.href}
            href={path.href}
            className="group block rounded-xl border border-border bg-white p-5 hover:border-fire/40 hover:shadow-sm transition-all"
          >
            <div className="flex items-start gap-4">
              <span className="text-2xl shrink-0">{path.icon}</span>
              <div className="flex-1 min-w-0">
                <h2 className="font-display text-base font-semibold text-ink group-hover:text-fire transition-colors">
                  {path.title}
                </h2>
                <p className="text-xs font-mono text-muted/70 mt-0.5">
                  {path.time}
                </p>
                <p className="text-sm font-body text-muted mt-1.5">
                  {path.description}
                </p>
              </div>
              <span className="text-muted/40 group-hover:text-fire transition-colors shrink-0 mt-1">
                &rarr;
              </span>
            </div>
          </Link>
        ))}

        {/* Snap a Cover — coming soon teaser */}
        <div className="rounded-xl border border-border/60 bg-cream/30 p-5 opacity-70">
          <div className="flex items-start gap-4">
            <span className="text-2xl shrink-0">📷</span>
            <div className="flex-1 min-w-0">
              <h2 className="font-display text-base font-semibold text-ink/60">
                Snap a cover
              </h2>
              <p className="text-xs font-mono text-muted/50 mt-0.5">
                Coming soon
              </p>
              <p className="text-sm font-body text-muted/50 mt-1.5">
                Take a photo of any book cover to look it up instantly.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center mt-8 space-y-2">
        <Link
          href="/reading/dna"
          className="block text-sm font-body text-muted hover:text-fire transition-colors"
        >
          Already know your taste? Take the Reading DNA quiz &rarr;
        </Link>
        <Link
          href="/reading/dna/results"
          className="block text-sm font-body text-muted/70 hover:text-ink transition-colors"
        >
          View your Reading DNA
        </Link>
      </div>
    </div>
  );
}
