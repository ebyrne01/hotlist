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
    <span className={clsx("inline-flex items-center gap-0.5 group/spice relative", className)}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg
          key={i}
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={clsx(
            "shrink-0",
            i < clamped
              ? isLowConfidence
                ? "text-fire/50"
                : "text-fire"
              : "text-border"
          )}
          aria-hidden="true"
        >
          <path d="M12 2C12 2 11 4 11 5C11 5.5 11.5 6 12 6C12.5 6 13 5.5 13 5C13 4 12 2 12 2Z" fill="currentColor" />
          <path d="M8 7C6 8 5 11 5 14C5 18 8 22 10 22C11 22 11.5 21 12 21C12.5 21 13 22 14 22C16 22 19 18 19 14C19 11 18 8 16 7C14.5 6 9.5 6 8 7Z" fill="currentColor" />
        </svg>
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
        <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-ink text-white text-xs font-mono px-2 py-1 rounded opacity-0 group-hover/spice:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-20">
          {tooltip}
        </span>
      )}
    </span>
  );
}
