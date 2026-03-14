import { clsx } from "clsx";
import { ExternalLink } from "lucide-react";

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
  return (
    <div className={clsx("flex flex-col items-center gap-0.5", className)}>
      {loading ? (
        <span className="text-xl font-display font-bold text-muted/60 animate-pulse">...</span>
      ) : (
        <span className="text-xl font-display font-bold text-ink">
          {score !== null && score !== undefined ? score.toFixed(1) : "\u2014"}
        </span>
      )}
      <span className="text-xs font-mono text-muted uppercase tracking-wide inline-flex items-center gap-0.5">
        {sourceLabels[source] || source}
        {external && <ExternalLink size={10} className="text-muted/70" />}
      </span>
      {ratingCount != null && ratingCount > 0 && (
        <span className="text-xs font-mono text-muted/80">
          {ratingCount.toLocaleString()} reviews
        </span>
      )}
    </div>
  );
}
