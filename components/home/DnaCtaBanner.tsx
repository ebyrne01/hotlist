import Link from "next/link";

export default function DnaCtaBanner() {
  return (
    <section className="py-6">
      <Link
        href="/get-started"
        className="block rounded-xl border border-fire/20 bg-fire/5 px-5 py-4 hover:bg-fire/10 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">🧬</span>
          <div className="flex-1 min-w-0">
            <p className="font-display text-base font-semibold text-ink">
              Discover your Reading DNA
            </p>
            <p className="text-xs font-body text-muted mt-0.5">
              Take a 30-second quiz or import your library for personalized recommendations.
            </p>
          </div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-fire shrink-0"
          >
            <polyline points="6 4 10 8 6 12" />
          </svg>
        </div>
      </Link>
    </section>
  );
}
