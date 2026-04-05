"use client";

import { clsx } from "clsx";

const CW_CATEGORIES = [
  { id: "sexual-assault", label: "Sexual assault / SA" },
  { id: "dubcon", label: "Dubious consent" },
  { id: "abuse", label: "Abuse (emotional/physical)" },
  { id: "self-harm", label: "Self-harm / suicide" },
  { id: "death", label: "Major character death" },
  { id: "cheating", label: "Cheating / infidelity" },
  { id: "addiction", label: "Addiction / substance abuse" },
  { id: "violence", label: "Graphic violence / gore" },
  { id: "pregnancy-loss", label: "Pregnancy loss" },
  { id: "child-harm", label: "Child abuse / harm to children" },
  { id: "kidnapping", label: "Kidnapping / captivity" },
  { id: "eating-disorder", label: "Eating disorders" },
];

interface ContentWarningStepProps {
  selected: Set<string>;
  onToggle: (cw: string) => void;
}

export default function ContentWarningStep({
  selected,
  onToggle,
}: ContentWarningStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold text-ink">
          Anything we should flag for you?
        </h2>
        <p className="text-sm font-body text-muted mt-2">
          We&apos;ll add a heads-up on books with these themes. You can always
          change this later.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto">
        {CW_CATEGORIES.map((cw) => {
          const isSelected = selected.has(cw.id);
          return (
            <button
              key={cw.id}
              onClick={() => onToggle(cw.id)}
              className={clsx(
                "px-3 py-2 rounded-lg text-sm font-body border transition-colors",
                isSelected
                  ? "bg-ink/10 border-ink/30 text-ink"
                  : "bg-white border-border text-muted hover:border-ink/20 hover:text-ink"
              )}
            >
              {cw.label}
            </button>
          );
        })}
      </div>

      {selected.size > 0 && (
        <p className="text-center text-xs font-mono text-muted/70">
          {selected.size} selected
        </p>
      )}
    </div>
  );
}

export { CW_CATEGORIES };
