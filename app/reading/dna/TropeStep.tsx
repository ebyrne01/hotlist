"use client";

import { clsx } from "clsx";

interface TropeStepProps {
  tropes: { slug: string; name: string }[];
  selected: Set<string>;
  onToggle: (slug: string) => void;
}

const MIN_TROPES = 3;

export default function TropeStep({ tropes, selected, onToggle }: TropeStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold text-ink">
          Pick tropes that make you pick up a book
        </h2>
        <p className="text-sm font-body text-muted mt-2">
          Select at least {MIN_TROPES}. These shape your Reading DNA.
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-2 max-w-lg mx-auto">
        {tropes.map((trope) => {
          const isSelected = selected.has(trope.slug);
          return (
            <button
              key={trope.slug}
              onClick={() => onToggle(trope.slug)}
              className={clsx(
                "inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-mono whitespace-nowrap border transition-colors duration-150",
                isSelected
                  ? "bg-fire text-white border-fire"
                  : "bg-brand-cream-dk text-ink border-border/60 hover:bg-fire hover:text-white hover:border-fire"
              )}
            >
              {trope.name}
            </button>
          );
        })}
      </div>

      {selected.size > 0 && selected.size < MIN_TROPES && (
        <p className="text-center text-xs text-muted font-body">
          {MIN_TROPES - selected.size} more to go
        </p>
      )}
    </div>
  );
}
