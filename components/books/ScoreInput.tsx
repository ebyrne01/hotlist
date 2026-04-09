"use client";

import { useState, useEffect, useRef } from "react";

interface ScoreInputProps {
  value: number | null;
  onChange: (score: number | null) => void;
}

export default function ScoreInput({ value, onChange }: ScoreInputProps) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commitValue(v: number | null) {
    setLocalValue(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(v), 500);
  }

  function step(delta: number) {
    const current = localValue ?? 0;
    const next = Math.round((current + delta) * 10) / 10;
    if (next < 0 || next > 5) return;
    commitValue(next);
  }

  function handleDirectInput(raw: string) {
    if (raw === "") {
      commitValue(null);
      return;
    }
    const parsed = parseFloat(raw);
    if (isNaN(parsed)) return;
    const clamped = Math.round(Math.min(5, Math.max(0, parsed)) * 10) / 10;
    commitValue(clamped);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => step(-0.1)}
        disabled={localValue === null || localValue <= 0}
        className="w-8 h-8 flex items-center justify-center rounded-md border border-border text-muted hover:border-fire/30 hover:text-ink transition-colors disabled:opacity-30"
        aria-label="Decrease score"
      >
        −
      </button>

      {editing ? (
        <input
          ref={inputRef}
          type="number"
          step="0.1"
          min="0"
          max="5"
          value={localValue ?? ""}
          onChange={(e) => handleDirectInput(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => { if (e.key === "Enter") setEditing(false); }}
          className="w-14 text-center font-display text-2xl font-bold text-ink border-b-2 border-fire/40 bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="w-14 text-center font-display text-2xl font-bold text-ink hover:text-fire transition-colors"
          aria-label="Tap to edit score"
        >
          {localValue != null ? localValue.toFixed(1) : "—"}
        </button>
      )}

      <button
        type="button"
        onClick={() => step(0.1)}
        disabled={localValue !== null && localValue >= 5}
        className="w-8 h-8 flex items-center justify-center rounded-md border border-border text-muted hover:border-fire/30 hover:text-ink transition-colors disabled:opacity-30"
        aria-label="Increase score"
      >
        +
      </button>

      <span className="text-xs font-mono text-muted ml-1">out of 5</span>
    </div>
  );
}
