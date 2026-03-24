import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Build Your Reading DNA — Hotlist",
  description:
    "Get personalized romance book recommendations. Take a quick quiz, import your Goodreads library, or scan your bookshelf.",
};

const ON_RAMPS = [
  {
    href: "/reading/dna",
    icon: "🎯",
    title: "Take the Quiz",
    subtitle: "30 seconds",
    description: "Answer 3 quick questions about your reading preferences.",
  },
  {
    href: "/reading/import/goodreads",
    icon: "📚",
    title: "Import Library",
    subtitle: "Goodreads / StoryGraph",
    description: "Upload your export file to bring in your full reading history.",
  },
  {
    href: "/reading/scan",
    icon: "📷",
    title: "Scan Barcodes",
    subtitle: "Physical books",
    description: "Use your phone camera to scan books on your shelf.",
  },
];

export default function GetStartedPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
      <div className="text-center mb-10">
        <div className="text-4xl mb-3">🧬</div>
        <h1 className="font-display text-3xl font-bold text-ink">
          Build Your Reading DNA
        </h1>
        <p className="text-sm font-body text-muted mt-3 max-w-md mx-auto">
          Tell us what you love so we can recommend books you&apos;ll actually
          want to read.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {ON_RAMPS.map((ramp) => (
          <Link
            key={ramp.href}
            href={ramp.href}
            className="block rounded-xl border border-border bg-white p-5 hover:border-fire/40 hover:shadow-sm transition-all text-center"
          >
            <div className="text-3xl mb-3">{ramp.icon}</div>
            <h2 className="font-display text-base font-semibold text-ink">
              {ramp.title}
            </h2>
            <p className="text-xs font-mono text-fire mt-1">{ramp.subtitle}</p>
            <p className="text-xs font-body text-muted mt-2">
              {ramp.description}
            </p>
          </Link>
        ))}
      </div>

      <div className="text-center mt-8">
        <Link
          href="/reading/dna/results"
          className="text-sm font-body text-muted hover:text-ink transition-colors"
        >
          Already have a Reading DNA? View yours →
        </Link>
      </div>
    </div>
  );
}
