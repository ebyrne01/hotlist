"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// ── Inline Score Badge ──────────────────────────────
// Read-only display of user's decimal score in the ratings row.
// Scoring now lives inside ReaderResponse (post-read expansion).

export function InlineUserRating({ bookId }: { bookId: string }) {
  const [score, setScore] = useState<number | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        supabase
          .from("user_ratings")
          .select("score, star_rating")
          .eq("user_id", data.user.id)
          .eq("book_id", bookId)
          .single()
          .then(({ data: existing }) => {
            if (existing) {
              // Prefer decimal score, fall back to star_rating
              const s = existing.score != null
                ? parseFloat(existing.score)
                : existing.star_rating ?? null;
              setScore(s);
            }
          });
      }
      setAuthChecked(true);
    });
  }, [bookId, supabase]);

  if (!authChecked || score === null) return null;

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-display text-lg font-bold text-fire">
        {score.toFixed(1)}
      </span>
      <span className="text-xs font-mono text-muted tracking-wide">
        Your rating
      </span>
    </div>
  );
}
