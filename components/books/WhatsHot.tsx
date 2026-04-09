import type { Rating } from "@/lib/types";

interface SeriesInfo {
  seriesName: string | null;
  seriesPosition: number | null;
  totalBooksInDb: number;
  highestPosition: number;
  latestPublishedYear: number | null;
}

interface WhatsHotProps {
  ratings: Rating[];
  creatorMentionCount: number;
  buzzSignals: { source: string; metadata: Record<string, unknown> }[];
  seriesInfo: SeriesInfo | null;
}

export default function WhatsHot({
  ratings,
  creatorMentionCount,
  buzzSignals,
  seriesInfo,
}: WhatsHotProps) {
  const signals: string[] = [];

  const gr = ratings.find((r) => r.source === "goodreads");
  const amz = ratings.find((r) => r.source === "amazon");

  // Tier 1: BookTok creator mentions
  if (creatorMentionCount >= 6) {
    signals.push(`📹 🔥 Trending — ${creatorMentionCount} BookTok creators have recommended this`);
  } else if (creatorMentionCount >= 3) {
    signals.push(`📹 Talked about by ${creatorMentionCount} BookTok creators`);
  } else if (creatorMentionCount >= 1) {
    signals.push(
      `📹 Mentioned by ${creatorMentionCount} BookTok creator${creatorMentionCount > 1 ? "s" : ""}`
    );
  }

  // Tier 2: Reddit buzz
  const redditSignal = buzzSignals.find((s) => s.source === "reddit_mention");
  const redditCount =
    (redditSignal?.metadata?.mention_count as number) ?? 0;
  if (redditCount >= 20) {
    signals.push("💬 Frequently discussed on Reddit");
  } else if (redditCount >= 5) {
    signals.push(`💬 Mentioned in ${redditCount}+ Reddit threads`);
  }

  // Tier 3: Bestseller signals
  if (buzzSignals.some((s) => s.source === "nyt_bestseller")) {
    signals.push("📰 NYT Bestseller");
  }
  if (buzzSignals.some((s) => s.source === "amazon_bestseller")) {
    signals.push("🛒 Amazon Bestseller in Romance");
  }

  // Tier 4: Goodreads social proof
  if (gr?.ratingCount) {
    if (gr.ratingCount >= 500_000) {
      signals.push(`📖 ${Math.round(gr.ratingCount / 1000)}k+ Goodreads ratings`);
    } else if (gr.ratingCount >= 100_000) {
      signals.push(`📖 ${Math.round(gr.ratingCount / 1000)}k+ Goodreads ratings`);
    } else if (gr.ratingCount >= 10_000) {
      signals.push(`📖 ${Math.round(gr.ratingCount / 1000)}k+ readers on Goodreads`);
    }
  }

  // Rating quality one-liners
  if (gr?.rating && gr.rating >= 4.3 && amz?.rating && amz.rating >= 4.5) {
    signals.push("⭐ Highly rated across the board");
  } else if (amz?.rating && gr?.rating && amz.rating - gr.rating > 0.5) {
    signals.push("⭐ Amazon readers rate this even higher than Goodreads");
  }

  // Series momentum
  if (seriesInfo && seriesInfo.seriesPosition) {
    const { totalBooksInDb, highestPosition, latestPublishedYear } = seriesInfo;
    const currentYear = new Date().getFullYear();
    const isLikelyComplete =
      totalBooksInDb >= highestPosition &&
      (latestPublishedYear === null || latestPublishedYear < currentYear - 1);

    if (isLikelyComplete && totalBooksInDb >= 2) {
      signals.push(
        `📚 Book ${seriesInfo.seriesPosition} of a completed ${totalBooksInDb}-book series`
      );
    } else if (totalBooksInDb >= 2) {
      signals.push(
        `📚 Book ${seriesInfo.seriesPosition} of an ongoing series (${totalBooksInDb} published)`
      );
    }
  }

  // Cap at 4
  const display = signals.length > 4 ? signals.slice(0, 4) : signals;

  // Empty state
  if (display.length === 0) {
    display.push("📗 New to Hotlist — be one of the first to rate it");
  }

  return (
    <section className="mt-6 pt-6 border-t border-border">
      <h2 className="text-xs font-mono text-muted uppercase tracking-wide mb-3">
        🔥 What Makes It Hot
      </h2>
      <div className="space-y-2">
        {display.map((signal, i) => (
          <p key={i} className="text-sm font-body text-ink leading-snug">
            {signal}
          </p>
        ))}
      </div>
    </section>
  );
}
