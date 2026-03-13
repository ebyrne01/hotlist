/**
 * SPICE DISPLAY — Unified spice rendering with peppers + attribution.
 *
 * Wraps chili peppers and SpiceAttribution in a single component.
 * Supports full mode (book detail, search cards) and compact mode (table cells).
 * Shows "Rate the spice" nudge for estimated sources.
 */

"use client";

import { clsx } from "clsx";
import SpiceAttribution, { isEstimatedSource } from "./SpiceAttribution";
import type { CompositeSpiceData } from "@/lib/types";

interface SpiceDisplayProps {
  composite: CompositeSpiceData | null;
  /** Compact mode: smaller peppers, tooltip instead of inline attribution */
  compact?: boolean;
  /** Show "Rate the spice" nudge for estimated sources */
  showNudge?: boolean;
  /** Link to book slug for the nudge CTA */
  bookSlug?: string;
  /** romance.io slug for attribution link */
  romanceIoSlug?: string | null;
  className?: string;
}

export default function SpiceDisplay({
  composite,
  compact = false,
  showNudge = false,
  bookSlug,
  romanceIoSlug,
  className,
}: SpiceDisplayProps) {
  if (!composite) {
    if (compact) {
      return <span className="text-muted/40 font-mono text-sm">{"\u2014"}</span>;
    }
    return (
      <span className="text-xs font-mono text-muted/50">Spice unknown</span>
    );
  }

  const clamped = Math.min(5, Math.max(1, Math.round(composite.score)));
  const isEstimated = isEstimatedSource(composite.primarySource);

  // Build tooltip for compact mode
  const tooltipText = `${composite.score.toFixed(1)}/5 spice · ${composite.attribution}`;

  if (compact) {
    return (
      <span
        className={clsx("inline-flex items-center gap-0.5 cursor-default", className)}
        title={tooltipText}
      >
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            className={clsx(
              "text-sm transition-opacity",
              i < clamped
                ? isEstimated
                  ? "opacity-60"
                  : "opacity-100"
                : "opacity-20 grayscale"
            )}
          >
            🌶️
          </span>
        ))}
      </span>
    );
  }

  return (
    <div className={clsx("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-0.5">
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className={clsx(
                "text-base transition-opacity",
                i < clamped
                  ? isEstimated
                    ? "opacity-60"
                    : "opacity-100"
                  : "opacity-20 grayscale"
              )}
            >
              🌶️
            </span>
          ))}
        </span>
      </div>

      <SpiceAttribution
        composite={composite}
        romanceIoSlug={romanceIoSlug}
      />

      {showNudge && isEstimated && bookSlug && (
        <a
          href={`/book/${bookSlug}`}
          className="text-[10px] font-mono text-fire/50 hover:text-fire transition-colors"
        >
          Rate the spice →
        </a>
      )}
    </div>
  );
}
