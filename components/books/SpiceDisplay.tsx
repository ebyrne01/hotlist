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
import { PepperIcon } from "@/components/ui/PepperIcon";
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
      return <span className="text-muted/60 font-mono text-sm">{"\u2014"}</span>;
    }
    return (
      <span className="text-xs font-mono text-muted">Spice unknown</span>
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
          className="text-xs font-mono text-fire/70 hover:text-fire transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fire rounded"
        >
          Rate the spice →
        </a>
      )}
    </div>
  );
}
