import { clsx } from "clsx";
import { ExternalLink } from "lucide-react";

function abbreviateCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

interface RatingBadgeProps {
  score: number | null;
  source: string;
  ratingCount?: number | null;
  loading?: boolean;
  className?: string;
  /** When true, shows external link icon next to source label */
  external?: boolean;
}

const sourceLabels: Record<string, string> = {
  goodreads: "Goodreads",
  amazon: "Amazon",
  romance_io: "romance.io",
};

export default function RatingBadge({
  score,
  source,
  ratingCount,
  loading,
  className,
  external,
}: RatingBadgeProps) {
  const label = sourceLabels[source] || source;
  const a11yLabel = `${label} rating: ${score !== null && score !== undefined ? score.toFixed(1) : "not available"}`;

  return (
    <div
      className={clsx("flex flex-col items-center gap-0.5", className)}
      aria-label={a11yLabel}
    >
      {loading ? (
        <span className="text-xl font-display font-bold text-muted/60 animate-pulse">...</span>
      ) : (
        <span className={clsx(
          "text-xl font-display font-bold",
          score !== null && score !== undefined ? "text-ink" : "text-muted/40",
        )}>
          {score !== null && score !== undefined ? score.toFixed(1) : "\u2014"}
        </span>
      )}
      <span className="text-xs font-mono text-muted uppercase tracking-wide inline-flex items-center gap-0.5">
        {label}
        {external && <ExternalLink size={10} className="text-muted/70" />}
      </span>
      {ratingCount != null && ratingCount > 0 && (
        <span className="text-xs font-mono text-muted/80">
          {abbreviateCount(ratingCount)} ratings
        </span>
      )}
    </div>
  );
}
