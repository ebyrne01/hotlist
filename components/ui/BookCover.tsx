"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Headphones } from "lucide-react";

type CoverSize = "sm" | "table" | "md" | "lg" | "fill";

interface BookCoverProps {
  title: string;
  coverUrl?: string | null;
  size?: CoverSize;
  className?: string;
  isAudiobook?: boolean;
}

const sizeStyles: Record<Exclude<CoverSize, "fill">, { className: string; width: number; height: number }> = {
  sm: { className: "w-[40px] h-[60px] text-sm", width: 40, height: 60 },
  table: { className: "w-[64px] h-[90px] text-base", width: 64, height: 90 },
  md: { className: "w-[80px] h-[120px] text-xl", width: 80, height: 120 },
  lg: { className: "w-[120px] h-[180px] text-3xl", width: 120, height: 180 },
};

const badgeSize: Record<CoverSize, string> = {
  sm: "text-[8px] px-0.5 py-px gap-0.5",
  table: "text-[9px] px-1 py-0.5 gap-0.5",
  md: "text-[10px] px-1 py-0.5 gap-0.5",
  lg: "text-xs px-1.5 py-0.5 gap-1",
  fill: "text-xs px-1.5 py-0.5 gap-1",
};

const iconSize: Record<CoverSize, number> = {
  sm: 8,
  table: 10,
  md: 10,
  lg: 12,
  fill: 12,
};

function Placeholder({ title, sizeClass, className }: { title: string; sizeClass: string; className?: string }) {
  return (
    <div
      className={clsx(
        "rounded-md shadow-sm flex items-center justify-center bg-gradient-to-br from-fire/20 to-gold/20 border border-border font-display font-bold text-fire/60",
        sizeClass,
        className
      )}
      aria-label={`Cover placeholder for ${title}`}
    >
      {title.charAt(0).toUpperCase()}
    </div>
  );
}

export default function BookCover({
  title,
  coverUrl,
  size = "md",
  className,
  isAudiobook = false,
}: BookCoverProps) {
  const [failed, setFailed] = useState(false);
  const isFill = size === "fill";
  const sizeClass = isFill ? "" : sizeStyles[size].className;

  if (!coverUrl || failed) {
    return <Placeholder title={title} sizeClass={sizeClass} className={className} />;
  }

  // When not an audiobook, render a plain img (no wrapper div) to preserve layout
  if (!isAudiobook) {
    return (
      <img
        src={coverUrl}
        alt={`Cover of ${title}`}
        {...(!isFill && { width: sizeStyles[size].width, height: sizeStyles[size].height })}
        className={clsx("rounded-md shadow-sm", sizeClass, className)}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className={clsx("relative", isFill ? "w-full h-full" : "inline-block")}>
      <img
        src={coverUrl}
        alt={`Cover of ${title}`}
        {...(!isFill && { width: sizeStyles[size].width, height: sizeStyles[size].height })}
        className={clsx("rounded-md shadow-sm", sizeClass, className)}
        onError={() => setFailed(true)}
      />
      <span
        className={clsx(
          "absolute bottom-1 left-1 inline-flex items-center rounded bg-fire text-white font-mono font-semibold backdrop-blur-sm",
          badgeSize[size]
        )}
      >
        <Headphones size={iconSize[size]} />
        {size !== "sm" && "Audio"}
      </span>
    </div>
  );
}
