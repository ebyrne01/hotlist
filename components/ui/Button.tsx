"use client";

import { clsx } from "clsx";
import { type ReactNode, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  children: ReactNode;
}

const variantStyles: Record<Variant, string> = {
  primary: "bg-fire text-white hover:bg-fire/90 active:bg-fire/80",
  secondary:
    "bg-white text-ink border border-border hover:bg-cream active:bg-border/40",
  ghost: "text-muted hover:text-ink hover:bg-ink/5 active:bg-ink/10",
};

const sizeStyles: Record<Size, string> = {
  sm: "text-sm px-3 min-h-[44px] sm:min-h-[36px] gap-1.5",
  md: "text-base px-4 min-h-[44px] gap-2",
  lg: "text-lg px-6 min-h-[48px] gap-2.5",
};

export default function Button({
  variant = "primary",
  size = "md",
  icon,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center rounded-lg font-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fire/50 disabled:opacity-50 disabled:pointer-events-none",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
}
