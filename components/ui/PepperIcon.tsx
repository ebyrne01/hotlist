/**
 * PEPPER ICON — SVG pepper with filled/hollow states.
 *
 * Used everywhere spice is displayed: book detail, cards, tables, share cards.
 * Replaces emoji 🌶️ for consistent cross-platform rendering and clear
 * filled vs hollow visual differentiation.
 *
 * - filled + default: solid fire color (known spice)
 * - filled + estimated: 50% opacity fire (estimated spice)
 * - filled + muted: 50% opacity (secondary display, e.g. community row)
 * - hollow: warm stone border color (empty pepper slot)
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
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={clsx(
        "shrink-0",
        filled
          ? muted
            ? "text-fire/50"
            : estimated
              ? "text-fire/50"
              : "text-fire"
          : "text-border",
        className,
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
