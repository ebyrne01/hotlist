import type { Metadata } from "next";
import CreatorFollowFlow from "@/components/onboarding/CreatorFollowFlow";

export const metadata: Metadata = {
  title: "Follow Creators — Hotlist",
  description: "Follow your favorite BookTok creators and discover their top book picks.",
};

export default function CreatorsPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-fire">
          BookTok path
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink">
          Start with the creators you already trust.
        </h1>
        <p className="text-sm font-body leading-6 text-muted-a11y mt-3 max-w-md mx-auto">
          Search for BookTok creators you love. We&apos;ll show you their top picks
          so you can rate them and build your first Hotlist.
        </p>
      </div>

      <CreatorFollowFlow />
    </div>
  );
}
