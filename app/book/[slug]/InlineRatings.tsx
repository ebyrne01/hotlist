"use client";

import { useState, useEffect, useCallback } from "react";
import { Star, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSignInModal } from "@/lib/auth/useSignInModal";
import { clsx } from "clsx";

// ── Inline Star Rating Badge ────────────────────────
// Lives in the ratings row alongside Goodreads + Amazon badges.

export function InlineUserRating({ bookId }: { bookId: string }) {
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [starRating, setStarRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const { openSignIn } = useSignInModal();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUser({ id: data.user.id });
        supabase
          .from("user_ratings")
          .select("star_rating")
          .eq("user_id", data.user.id)
          .eq("book_id", bookId)
          .single()
          .then(({ data: existing }) => {
            if (existing?.star_rating) {
              setStarRating(existing.star_rating);
            }
          });
      }
      setAuthChecked(true);
    });
  }, [bookId, supabase]);

  const saveRating = useCallback(
    async (value: number) => {
      if (!user || saving) return;
      setSaving(true);
      const prevStarRating = starRating;
      // Optimistic update
      setStarRating(value);
      setEditing(false);

      try {
        await supabase.from("user_ratings").upsert(
          {
            user_id: user.id,
            book_id: bookId,
            star_rating: value,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,book_id" }
        );

        // Auto-set reading status to "read" if none set
        const { data: currentStatus } = await supabase
          .from("reading_status")
          .select("status")
          .eq("user_id", user.id)
          .eq("book_id", bookId)
          .single();

        if (!currentStatus) {
          await supabase.from("reading_status").upsert(
            {
              user_id: user.id,
              book_id: bookId,
              status: "read",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id,book_id" }
          );
        }

        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1500);
      } catch (err) {
        console.error("[saveRating] failed:", err);
        setStarRating(prevStarRating);
      } finally {
        setSaving(false);
      }
    },
    [user, saving, starRating, bookId, supabase]
  );

  if (!authChecked) return null;

  // Logged out: "+ Rate it" CTA
  if (!user) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <button
          onClick={() => openSignIn()}
          className="text-xl font-display font-bold text-fire hover:text-fire/80 transition-colors"
        >
          + Rate
        </button>
        <span className="text-[10px] font-mono text-muted uppercase tracking-wide">
          Your Rating
        </span>
        <button
          onClick={() => openSignIn()}
          className="text-[9px] font-mono text-fire/60 hover:text-fire transition-colors"
        >
          Sign in &rarr;
        </button>
      </div>
    );
  }

  const display = hovered || starRating;

  // Just saved: brief checkmark
  if (justSaved) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-xl font-display font-bold text-green-600">
          <Check size={24} strokeWidth={3} />
        </span>
        <span className="text-[10px] font-mono text-green-600 uppercase tracking-wide">
          Saved
        </span>
      </div>
    );
  }

  // Logged in, rated, not editing: show their rating
  if (starRating > 0 && !editing) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-xl font-display font-bold text-ink">
          {starRating}.0
        </span>
        <span className="text-[10px] font-mono text-muted uppercase tracking-wide">
          Your Rating
        </span>
        <button
          onClick={() => setEditing(true)}
          className="text-[9px] font-mono text-fire/60 hover:text-fire transition-colors"
        >
          Edit
        </button>
      </div>
    );
  }

  // Logged in, unrated or editing: interactive stars
  return (
    <div
      className="flex flex-col items-center gap-0.5"
      onMouseLeave={() => setHovered(0)}
    >
      <span className="inline-flex items-center gap-0.5">
        {Array.from({ length: 5 }, (_, i) => {
          const starIndex = i + 1;
          const filled = starIndex <= Math.round(display);
          return (
            <button
              key={i}
              type="button"
              disabled={saving}
              className="p-0 transition-colors cursor-pointer hover:scale-110"
              onMouseEnter={() => setHovered(starIndex)}
              onClick={() => saveRating(starIndex)}
              aria-label={`${starIndex} star${starIndex > 1 ? "s" : ""}`}
            >
              <Star
                size={18}
                className={clsx(
                  "transition-colors",
                  filled ? "fill-gold text-gold" : "fill-none text-border"
                )}
              />
            </button>
          );
        })}
      </span>
      <span className="text-[10px] font-mono text-muted uppercase tracking-wide">
        Your Rating
      </span>
    </div>
  );
}

