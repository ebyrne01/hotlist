/**
 * SPICE ATTRIBUTION — Shows the source of a composite spice score.
 *
 * Varies opacity and label text based on the primarySource:
 *   community → full opacity, "Rated by X readers"
 *   romance_io → full opacity, "from Romance.io" with external link
 *   review_classifier → 70% opacity, "estimated from reviews"
 *   llm_inference → 60% opacity, "estimated from description"
 *   genre_bucketing → 50% opacity, "estimated from genre"
 */

import { ExternalLink } from "lucide-react";
import { clsx } from "clsx";
import type { CompositeSpiceData } from "@/lib/types";

interface SpiceAttributionProps {
  composite: CompositeSpiceData;
  /** Compact mode hides text, used in table cells */
  compact?: boolean;
  romanceIoSlug?: string | null;
  className?: string;
}

const SOURCE_OPACITY: Record<string, string> = {
  community: "opacity-100",
  romance_io: "opacity-100",
  review_classifier: "opacity-70",
  llm_inference: "opacity-60",
  genre_bucketing: "opacity-50",
};

/** Is this an estimated (non-authoritative) source? */
export function isEstimatedSource(primarySource: string): boolean {
  return !["community", "romance_io"].includes(primarySource);
}

export default function SpiceAttribution({
  composite,
  compact = false,
  romanceIoSlug,
  className,
}: SpiceAttributionProps) {
  const opacity = SOURCE_OPACITY[composite.primarySource] ?? "opacity-50";

  if (compact) {
    return null; // Tooltip handles attribution in compact mode
  }

  const romanceIoUrl = romanceIoSlug
    ? `https://romance.io/books/${romanceIoSlug}`
    : null;

  return (
    <div
      className={clsx(
        "text-xs font-mono text-muted",
        opacity,
        className
      )}
    >
      {composite.conflictFlag ? (
        <span className="text-fire/70 italic">
          {composite.attribution}
        </span>
      ) : composite.primarySource === "romance_io" && romanceIoUrl ? (
        <a
          href={romanceIoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-fire/60 hover:text-fire transition-colors"
        >
          romance.io
          <ExternalLink size={10} />
        </a>
      ) : (
        <span>{composite.attribution}</span>
      )}

      {!composite.conflictFlag && composite.signalCount > 1 && (
        <span className="ml-1 text-muted/70">
          ({composite.signalCount} signals)
        </span>
      )}
    </div>
  );
}
