"use client";

import { clsx } from "clsx";
import { PepperRow } from "@/components/ui/PepperIcon";

interface SpiceStepProps {
  selected: number | null;
  onSelect: (level: number) => void;
}

const SPICE_OPTIONS = [
  { level: 1, label: "Clean", description: "Sweet romance, closed door" },
  { level: 2, label: "Mild", description: "Fade to black, light tension" },
  { level: 3, label: "Medium", description: "Some steamy scenes" },
  { level: 4, label: "Hot", description: "Explicit open door" },
  { level: 5, label: "Scorching", description: "Very explicit, frequent scenes" },
];

export default function SpiceStep({ selected, onSelect }: SpiceStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold text-ink">
          How much heat do you like?
        </h2>
        <p className="text-sm font-body text-muted mt-2">
          This helps us match you with books at the right spice level.
        </p>
      </div>

      <div className="grid gap-3 max-w-md mx-auto">
        {SPICE_OPTIONS.map((option) => (
          <button
            key={option.level}
            onClick={() => onSelect(option.level)}
            className={clsx(
              "flex items-center gap-4 p-4 rounded-lg border-2 transition-all text-left",
              selected === option.level
                ? "border-fire bg-fire/5"
                : "border-border hover:border-fire/40 bg-white"
            )}
          >
            <PepperRow level={option.level} size={20} />
            <div className="flex-1 min-w-0">
              <span className="font-body font-semibold text-ink">
                {option.label}
              </span>
              <span className="block text-xs text-muted font-body mt-0.5">
                {option.description}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
