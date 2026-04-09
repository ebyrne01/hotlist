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
        <div className="text-4xl mb-4">👀</div>
        <h1 className="font-display text-2xl font-bold text-ink">
          Follow Your Favorite Creators
        </h1>
        <p className="text-sm font-body text-muted mt-3 max-w-md mx-auto">
          Search for BookTok creators you love. We&apos;ll show you their top picks
          so you can rate them and build your first Hotlist.
        </p>
      </div>

      <CreatorFollowFlow />
    </div>
  );
}
