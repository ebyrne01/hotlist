interface Props {
  count: number;
  target?: number;
}

export default function DnaProgressBar({ count, target = 25 }: Props) {
  const progress = Math.min(count / target, 1);
  const remaining = Math.max(target - count, 0);
  const unlocked = count >= target;

  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono text-muted uppercase tracking-wide">
          🧬 Reading DNA
        </span>
        <span className="text-xs font-mono text-ink">
          {count}/{target} books
        </span>
      </div>

      <div className="w-full h-2 bg-border rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber-500 to-fire rounded-full transition-all duration-500"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <p className="text-xs font-body text-muted mt-2">
        {unlocked
          ? "🧬 Reading DNA unlocked! View your taste profile."
          : `${remaining} more to unlock your taste profile`}
      </p>
    </div>
  );
}
