import type { Rating } from "@/lib/types";

interface SeriesInfo {
  totalBooksInDb: number;
  highestPosition: number;
  latestPublishedYear: number | null;
}

interface CoolYouOffProps {
  ratings: Rating[];
  seriesInfo: SeriesInfo | null;
  goodreadsRatingCount: number | null;
}

export default function WhatMightCoolYouOff({
  ratings,
  seriesInfo,
  goodreadsRatingCount,
}: CoolYouOffProps) {
  const warnings: string[] = [];

  // Series incomplete
  if (seriesInfo) {
    const { totalBooksInDb, highestPosition, latestPublishedYear } = seriesInfo;
    const currentYear = new Date().getFullYear();

    // If highest numbered position exceeds books we have, likely incomplete
    const positionGap = highestPosition > totalBooksInDb;
    // If latest book published recently, series is probably ongoing
    const recentlyPublished =
      latestPublishedYear !== null && latestPublishedYear >= currentYear - 1;

    if (positionGap || (recentlyPublished && totalBooksInDb < highestPosition + 2)) {
      warnings.push(
        `⏳ This series may not be complete yet — ${totalBooksInDb} of ${highestPosition} books published`
      );
    }
  }

  // Polarizing ratings (spread > 0.5 across 2+ platforms)
  const ratingValues = ratings
    .map((r) => r.rating)
    .filter((r): r is number => r !== null);
  if (ratingValues.length >= 2) {
    const spread = Math.max(...ratingValues) - Math.min(...ratingValues);
    if (spread > 0.5) {
      const sources = ratings
        .filter((r) => r.rating !== null)
        .map((r) => {
          const labels: Record<string, string> = {
            goodreads: "GR",
            amazon: "AMZ",
            romance_io: "R.io",
          };
          return `${r.rating!.toFixed(1)} ${labels[r.source] ?? r.source}`;
        });
      warnings.push(
        `📊 Readers are divided — ratings range from ${sources.join(" to ")}`
      );
    }
  }

  // Low review volume
  if (goodreadsRatingCount !== null && goodreadsRatingCount < 1000) {
    warnings.push(
      `🔍 Still under the radar — fewer than 1,000 Goodreads reviews`
    );
  }

  // If nothing applies, don't render
  if (warnings.length === 0) return null;

  return (
    <section className="mt-6 pt-6 border-t border-border">
      <h2 className="text-xs font-mono text-muted uppercase tracking-wide mb-3">
        🧊 What Might Cool You Off
      </h2>
      <div className="space-y-2">
        {warnings.map((warning, i) => (
          <p key={i} className="text-sm font-body text-muted leading-snug">
            {warning}
          </p>
        ))}
      </div>
    </section>
  );
}
