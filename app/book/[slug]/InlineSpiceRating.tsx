"use client";

import { useState, useEffect, useCallback } from "react";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSignInModal } from "@/lib/auth/useSignInModal";
import { PepperIcon, PepperRow } from "@/components/ui/PepperIcon";

/**
 * Inline personal spice rating for the hero area.
 * Shows "Your take: 🌶️🌶️🌶️🌶️🌶️" with interactive peppers.
 */
export default function InlineSpiceRating({ bookId }: { bookId: string }) {
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [userSpice, setUserSpice] = useState(0);
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
          .select("spice_rating")
          .eq("user_id", data.user.id)
          .eq("book_id", bookId)
          .single()
          .then(({ data: existing }) => {
            if (existing?.spice_rating) {
              setUserSpice(existing.spice_rating);
            }
          });
      }
      setAuthChecked(true);
    });
  }, [bookId, supabase]);

  const saveSpice = useCallback(
    async (value: number) => {
      if (!user || saving) return;
      setSaving(true);
      const prev = userSpice;
      setUserSpice(value);
      setEditing(false);

      try {
        await supabase.from("user_ratings").upsert(
          {
            user_id: user.id,
            book_id: bookId,
            spice_rating: value,
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

        // Trigger server-side community aggregation (fire-and-forget)
        fetch("/api/books/refresh-spice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookId }),
        }).catch(() => {});

        // Update Reading DNA signal (fire-and-forget)
        fetch("/api/reading-dna/recompute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookId,
            signalType: "rating",
            weight: value >= 5 ? 1.0 : value >= 4 ? 0.8 : value >= 3 ? 0.6 : 0.3,
          }),
        }).catch(() => {});

        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1500);
      } catch (err) {
        console.error("[saveSpice] failed:", err);
        setUserSpice(prev);
      } finally {
        setSaving(false);
      }
    },
    [user, saving, userSpice, bookId, supabase]
  );

  if (!authChecked) return null;

  // Logged out: interactive peppers that trigger auth
  if (!user) {
    return (
      <div className="flex items-center gap-2 mt-1">
        <span className="text-[11px] font-mono text-stone-400">Your take:</span>
        <span className="inline-flex items-center gap-0.5">
          {Array.from({ length: 5 }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => openSignIn()}
              className="transition-transform cursor-pointer hover:scale-125"
            >
              <PepperIcon filled={false} size={16} />
            </button>
          ))}
        </span>
      </div>
    );
  }

  // Just saved
  if (justSaved) {
    return (
      <div className="flex items-center gap-2 mt-1">
        <span className="text-[11px] font-mono text-stone-400">Your take:</span>
        <span className="inline-flex items-center gap-1 text-xs font-mono text-green-600">
          <Check size={12} strokeWidth={3} /> Saved!
        </span>
      </div>
    );
  }

  // Rated, not editing
  if (userSpice > 0 && !editing) {
    return (
      <div className="flex items-center gap-2 mt-1">
        <span className="text-[11px] font-mono text-stone-400">Your take:</span>
        <PepperRow level={userSpice} size={16} />
        <button
          onClick={() => setEditing(true)}
          className="text-[11px] font-mono text-stone-400 hover:text-fire transition-colors"
        >
          edit
        </button>
      </div>
    );
  }

  // Unrated or editing: interactive peppers
  return (
    <div className="flex items-center gap-2 mt-1">
      <span className="text-[11px] font-mono text-stone-400">Your take:</span>
      <span className="inline-flex items-center gap-0.5">
        {Array.from({ length: 5 }, (_, i) => (
          <button
            key={i}
            type="button"
            disabled={saving}
            onClick={() => saveSpice(i + 1)}
            className="transition-transform cursor-pointer hover:scale-125"
          >
            <PepperIcon filled={i < userSpice} size={16} />
          </button>
        ))}
      </span>
    </div>
  );
}
