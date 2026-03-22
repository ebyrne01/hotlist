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
      {/* Stem — small curved calyx */}
      <path
        d="M11.5 4.5C11.5 3.5 12.5 2 13.5 1.5C14.5 1 15 1.5 14.5 2.5C14 3.5 12.5 5 11.5 4.5Z"
        fill="currentColor"
      />
      {/* Chili body — long curved taper like 🌶️ */}
      <path
        d="M12 5C14.5 5.5 17 8 17.5 11.5C18 15 16.5 18.5 14 21C12.5 22.5 11 23 10.5 22.5C10 22 10.5 20.5 11.5 18C12.5 15.5 13 13 12.5 10C12 7.5 11 6 10.5 5.5C10 5 10.5 4.5 12 5Z"
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
