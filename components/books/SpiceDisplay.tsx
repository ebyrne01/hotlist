/**
 * SPICE DISPLAY — Unified spice rendering with peppers + attribution.
 *
 * Wraps chili peppers and SpiceAttribution in a single component.
 * Supports full mode (book detail, search cards) and compact mode (table cells).
 * Shows "Rate the spice" nudge for estimated sources.
 *
 * Uses SVG peppers for clear filled vs empty visual differentiation.
 */

"use client";

import { clsx } from "clsx";
import SpiceAttribution, { isEstimatedSource } from "./SpiceAttribution";
import type { CompositeSpiceData } from "@/lib/types";

/** SVG pepper icon — fill color controlled via className */
function PepperIcon({ filled, size, estimated }: { filled: boolean; size: number; estimated?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={clsx(
        "shrink-0",
        filled
          ? estimated
            ? "text-fire/50"
            : "text-fire"
          : "text-border"
      )}
      aria-hidden="true"
    >
      {/* Stem */}
      <path
        d="M12 2C12 2 11 4 11 5C11 5.5 11.5 6 12 6C12.5 6 13 5.5 13 5C13 4 12 2 12 2Z"
        fill="currentColor"
      />
      {/* Pepper body */}
      <path
        d="M8 7C6 8 5 11 5 14C5 18 8 22 10 22C11 22 11.5 21 12 21C12.5 21 13 22 14 22C16 22 19 18 19 14C19 11 18 8 16 7C14.5 6 9.5 6 8 7Z"
        fill="currentColor"
      />
    </svg>
  );
}

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
  const pepperSize = compact ? 14 : 18;

  // Build tooltip for compact mode
  const tooltipText = `${composite.score.toFixed(1)}/5 spice · ${composite.attribution}`;

  // Accessibility label
  const a11yLabel = `Spice level ${clamped} of 5`;

  if (compact) {
    return (
      <span
        className={clsx("inline-flex items-center gap-px cursor-default", className)}
        title={tooltipText}
        role="img"
        aria-label={a11yLabel}
      >
        {Array.from({ length: 5 }, (_, i) => (
          <PepperIcon key={i} filled={i < clamped} size={pepperSize} estimated={isEstimated} />
        ))}
      </span>
    );
  }

  return (
    <div className={clsx("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-px" role="img" aria-label={a11yLabel}>
          {Array.from({ length: 5 }, (_, i) => (
            <PepperIcon key={i} filled={i < clamped} size={pepperSize} estimated={isEstimated} />
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
