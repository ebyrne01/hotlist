import { clsx } from "clsx";

interface BookCardSkeletonProps {
  className?: string;
}

export default function BookCardSkeleton({ className }: BookCardSkeletonProps) {
  return (
    <div
      className={clsx(
        "flex gap-3 rounded-lg border border-border bg-white p-3 animate-pulse",
        className
      )}
    >
      {/* Cover placeholder */}
      <div className="w-[80px] h-[120px] rounded-md bg-border/60 shrink-0" />

      <div className="flex flex-col gap-2 flex-1 py-1">
        {/* Title */}
        <div className="h-4 w-3/4 rounded bg-border/60" />
        {/* Author */}
        <div className="h-3 w-1/2 rounded bg-border/40" />
        {/* Rating row */}
        <div className="flex gap-2 mt-auto">
          <div className="h-3 w-10 rounded bg-border/40" />
          <div className="h-3 w-10 rounded bg-border/40" />
          <div className="h-3 w-10 rounded bg-border/40" />
        </div>
        {/* Trope badges */}
        <div className="flex gap-1.5">
          <div className="h-5 w-16 rounded-full bg-border/40" />
          <div className="h-5 w-20 rounded-full bg-border/40" />
        </div>
      </div>
    </div>
  );
}
