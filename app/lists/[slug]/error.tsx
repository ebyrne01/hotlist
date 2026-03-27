"use client";

import Link from "next/link";

export default function ListError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center">
      <h1 className="font-display text-2xl font-bold text-ink">
        We couldn&apos;t load this list
      </h1>
      <p className="mt-3 text-sm font-body text-ink/60">
        Something went wrong. Please try again.
      </p>
      <div className="mt-6 flex gap-3">
        <button
          onClick={() => reset()}
          className="px-5 py-2 bg-fire text-white text-sm font-mono rounded-md hover:bg-fire/90 transition-colors"
        >
          Try again
        </button>
        <Link
          href="/lists"
          className="px-5 py-2 border border-ink/20 text-sm font-mono rounded-md hover:bg-ink/5 transition-colors"
        >
          My lists
        </Link>
      </div>
    </div>
  );
}
