"use client";

import { Star } from "lucide-react";
import { clsx } from "clsx";
import { useState } from "react";

interface StarRatingProps {
  rating: number;
  mode?: "display" | "interactive";
  onChange?: (rating: number) => void;
  className?: string;
}

export default function StarRating({
  rating,
  mode = "display",
  onChange,
  className,
}: StarRatingProps) {
  const [hovered, setHovered] = useState(0);
  const display = hovered || rating;

  return (
    <span
      className={clsx("inline-flex items-center gap-0.5", className)}
      onMouseLeave={() => mode === "interactive" && setHovered(0)}
    >
      {Array.from({ length: 5 }, (_, i) => {
        const starIndex = i + 1;
        const filled = starIndex <= Math.round(display);
        return (
          <button
            key={i}
            type="button"
            disabled={mode === "display"}
            className={clsx(
              "p-0 transition-colors",
              mode === "interactive"
                ? "cursor-pointer hover:scale-110"
                : "cursor-default"
            )}
            onMouseEnter={() => mode === "interactive" && setHovered(starIndex)}
            onClick={() => mode === "interactive" && onChange?.(starIndex)}
            aria-label={`${starIndex} star${starIndex > 1 ? "s" : ""}`}
          >
            <Star
              size={18}
              className={clsx(
                "transition-colors",
                filled
                  ? "fill-gold text-gold"
                  : "fill-none text-border"
              )}
            />
          </button>
        );
      })}
      <span className="sr-only">{Math.round(display)} of 5 stars</span>
    </span>
  );
}
