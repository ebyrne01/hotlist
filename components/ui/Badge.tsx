import { clsx } from "clsx";
import { type ReactNode } from "react";

type Variant = "trope" | "fire" | "muted" | "included" | "excluded";

interface BadgeProps {
  variant?: Variant;
  children: ReactNode;
  className?: string;
}

const variantStyles: Record<Variant, string> = {
  trope: "bg-brand-cream-dk text-ink border border-border/60 hover:bg-fire hover:text-white hover:border-fire transition-colors duration-150",
  fire: "bg-fire/10 text-fire border border-fire/20",
  muted: "bg-ink/5 text-muted border border-border",
  included: "bg-fire text-white border border-fire",
  excluded: "bg-ink/5 text-muted/60 border border-border line-through",
};

export default function Badge({
  variant = "muted",
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-mono whitespace-nowrap",
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
