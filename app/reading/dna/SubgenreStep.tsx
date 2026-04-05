"use client";

import { clsx } from "clsx";
import { CANONICAL_SUBGENRES } from "@/lib/books/subgenre-classifier";

interface SubgenreStepProps {
  selected: Set<string>;
  onToggle: (slug: string) => void;
}

export default function SubgenreStep({ selected, onToggle }: SubgenreStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold text-ink">
          What do you read?
        </h2>
        <p className="text-sm font-body text-muted mt-2">
          Pick all the subgenres you enjoy. This shapes everything that follows.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto">
        {CANONICAL_SUBGENRES.map((sg) => {
          const isSelected = selected.has(sg.slug);
          return (
            <button
              key={sg.slug}
              onClick={() => onToggle(sg.slug)}
              className={clsx(
                "rounded-xl border px-4 py-3.5 text-left transition-colors",
                isSelected
                  ? "border-fire bg-fire/5"
                  : "border-border bg-white hover:border-fire/40"
              )}
            >
              <p className="font-display text-sm font-semibold text-ink">
                {sg.label}
              </p>
              <p className="text-xs font-body text-muted mt-0.5 leading-snug">
                {sg.description}
              </p>
            </button>
          );
        })}
      </div>

      {selected.size === 0 && (
        <p className="text-center text-xs text-muted font-body">
          Select at least 1 to continue
        </p>
      )}
    </div>
  );
}
