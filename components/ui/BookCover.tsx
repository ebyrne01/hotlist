import { clsx } from "clsx";

type CoverSize = "sm" | "md" | "lg" | "fill";

interface BookCoverProps {
  title: string;
  coverUrl?: string | null;
  size?: CoverSize;
  className?: string;
}

const sizeStyles: Record<Exclude<CoverSize, "fill">, { className: string; width: number; height: number }> = {
  sm: { className: "w-[40px] h-[60px] text-sm", width: 40, height: 60 },
  md: { className: "w-[80px] h-[120px] text-xl", width: 80, height: 120 },
  lg: { className: "w-[120px] h-[180px] text-3xl", width: 120, height: 180 },
};

export default function BookCover({
  title,
  coverUrl,
  size = "md",
  className,
}: BookCoverProps) {
  const isFill = size === "fill";
  const sizeClass = isFill ? "" : sizeStyles[size].className;
  const initial = title.charAt(0).toUpperCase();

  if (coverUrl) {
    return (
      <img
        src={coverUrl}
        alt={`Cover of ${title}`}
        {...(!isFill && { width: sizeStyles[size].width, height: sizeStyles[size].height })}
        className={clsx(
          "rounded-md shadow-sm",
          sizeClass,
          className
        )}
      />
    );
  }

  return (
    <div
      className={clsx(
        "rounded-md shadow-sm flex items-center justify-center bg-gradient-to-br from-fire/20 to-gold/20 border border-border font-display font-bold text-fire/60",
        sizeClass,
        className
      )}
      aria-label={`Cover placeholder for ${title}`}
    >
      {initial}
    </div>
  );
}
