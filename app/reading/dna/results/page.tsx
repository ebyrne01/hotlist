export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Your Reading DNA — Hotlist",
  description: "Your personalized reading preference profile is ready.",
};

export default function ReadingDnaResultsPage() {
  return (
    <div className="max-w-lg mx-auto px-4 py-16 text-center">
      <div className="text-5xl mb-4">🧬</div>
      <h1 className="font-display text-3xl font-bold text-ink">
        Your Reading DNA is ready!
      </h1>
      <p className="text-sm font-body text-muted mt-3 max-w-sm mx-auto">
        We&apos;ll use your preferences to recommend books you&apos;ll love.
        Check out your personalized picks on the homepage.
      </p>

      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-lg font-body font-medium bg-fire text-white hover:bg-fire/90 px-6 min-h-[44px] transition-colors"
        >
          See your recommendations
        </Link>
        <Link
          href="/reading"
          className="inline-flex items-center justify-center rounded-lg font-body font-medium text-muted hover:text-ink hover:bg-ink/5 px-4 min-h-[44px] transition-colors"
        >
          Import more books
        </Link>
      </div>
    </div>
  );
}
