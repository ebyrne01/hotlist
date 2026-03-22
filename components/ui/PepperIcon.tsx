/**
 * PEPPER ICON — Uses the 🌶️ emoji directly for the pepper.
 *
 * Used everywhere spice is displayed: book detail, cards, tables, share cards.
 *
 * - filled + default: full opacity (known spice)
 * - filled + estimated: 50% opacity (estimated spice)
 * - filled + muted: 50% opacity (secondary display, e.g. community row)
 * - hollow: 20% opacity (empty pepper slot)
 */

import { clsx } from "clsx";

interface PepperIconProps {
  filled: boolean;
  size?: number;
  /** Show at reduced opacity for estimated/low-confidence sources */
  estimated?: boolean;
  /** Show at reduced opacity for secondary displays */
  muted?: boolean;
  className?: string;
}

export function PepperIcon({
  filled,
  size = 16,
  estimated = false,
  muted = false,
  className,
}: PepperIconProps) {
  return (
    <span
      style={{ fontSize: size, lineHeight: 1 }}
      className={clsx(
        "shrink-0 select-none",
        filled
          ? muted
            ? "opacity-50"
            : estimated
              ? "opacity-50"
              : "opacity-100"
          : "opacity-20 grayscale",
        className,
      )}
      aria-hidden="true"
    >
      🌶️
    </span>
  );
}

/**
 * Render a row of 5 pepper icons for a given spice level.
 * Handles null/unknown: shows 5 hollow peppers.
 */
export function PepperRow({
  level,
  size = 16,
  estimated = false,
  muted = false,
  className,
}: {
  level: number | null;
  size?: number;
  estimated?: boolean;
  muted?: boolean;
  className?: string;
}) {
  const clamped = level ? Math.min(5, Math.max(1, Math.round(level))) : 0;
  return (
    <span className={clsx("inline-flex items-center gap-0.5", className)}>
      {Array.from({ length: 5 }, (_, i) => (
        <PepperIcon
          key={i}
          filled={i < clamped}
          size={size}
          estimated={estimated}
          muted={muted}
        />
      ))}
    </span>
  );
}
