"use client";

import { clsx } from "clsx";
import { useSignInModal } from "@/lib/auth/useSignInModal";

type SpiceSource = "romance_io" | "hotlist_community" | "goodreads_inference";
type Confidence = "low" | "medium" | "high";

interface SpiceIndicatorProps {
  level?: number | null;
  source?: SpiceSource | null;
  confidence?: Confidence | null;
  ratingCount?: number;
  showSource?: boolean;
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
  showSource = true,
  className,
}: SpiceIndicatorProps) {
  const { openSignIn } = useSignInModal();

  // No spice data at all
  if (!level || !source) {
    return (
      <span className={clsx("inline-flex flex-col items-start gap-0.5", className)}>
        <span className="text-xs font-mono text-muted/50">Spice unknown</span>
        <button
          onClick={() => openSignIn()}
          className="text-[10px] font-mono text-fire/70 hover:text-fire transition-colors text-left"
        >
          Be the first to rate the spice &rarr;
        </button>
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
      {showSource && source === "goodreads_inference" && (
        <span className="text-[9px] font-mono text-muted/40 ml-0.5">est.</span>
      )}
      {showSource && source === "hotlist_community" && ratingCount && ratingCount > 0 && (
        <span className="text-[9px] font-mono text-muted/40 ml-0.5">{ratingCount} ratings</span>
      )}
      <span className="sr-only">
        Spice level {clamped} of 5
        {tooltip && `, ${tooltip}`}
      </span>
      {tooltip && (
        <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-ink text-white text-xs font-mono px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-20">
          {tooltip}
        </span>
      )}
    </span>
  );
}
