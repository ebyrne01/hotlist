"use client";

import { clsx } from "clsx";
import Link from "next/link";

type SpiceSource = "romance_io" | "hotlist_community" | "goodreads_inference";
type Confidence = "low" | "medium" | "high";

interface SpiceIndicatorProps {
  level?: number | null;
  source?: SpiceSource | null;
  confidence?: Confidence | null;
  ratingCount?: number;
  className?: string;
}

function getTooltip(source: SpiceSource, confidence?: Confidence | null, ratingCount?: number): string {
  if (source === "hotlist_community") {
    return ratingCount
      ? `Rated by Hotlist readers \u00B7 ${ratingCount} ratings`
      : "Rated by Hotlist readers";
  }
  if (source === "goodreads_inference") {
    if (confidence === "low") return "Estimated from limited Goodreads data";
    return "Inferred from Goodreads reader shelves";
  }
  return "";
}

export default function SpiceIndicator({
  level,
  source,
  confidence,
  ratingCount,
  className,
}: SpiceIndicatorProps) {
  // No spice data at all
  if (!level || !source) {
    return (
      <span className={clsx("inline-flex flex-col items-start gap-0.5", className)}>
        <span className="text-xs font-mono text-muted/50">Spice unknown</span>
        <Link
          href="/?login=true"
          className="text-[10px] font-mono text-fire/70 hover:text-fire transition-colors"
        >
          Be the first to rate the spice &rarr;
        </Link>
      </span>
    );
  }

  const clamped = Math.min(5, Math.max(1, Math.round(level)));
  const isLowConfidence = source === "goodreads_inference" && confidence === "low";
  const tooltip = getTooltip(source, confidence, ratingCount);

  return (
    <span className={clsx("inline-flex items-center gap-0.5 group relative", className)}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={clsx(
            "text-base transition-opacity",
            i < clamped
              ? isLowConfidence
                ? "opacity-50"
                : "opacity-100"
              : "opacity-20 grayscale"
          )}
          aria-hidden="true"
        >
          🌶️
        </span>
      ))}
      <span className="sr-only">
        Spice level {clamped} of 5
        {tooltip && `, ${tooltip}`}
      </span>
      {tooltip && (
        <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-ink text-white text-xs font-mono px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
          {tooltip}
        </span>
      )}
    </span>
  );
}
