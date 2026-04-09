"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSignInModal } from "@/lib/auth/useSignInModal";
import { clsx } from "clsx";
import type { ReaderResponse as ReaderResponseType, UserRating } from "@/lib/types";
import { isPreRead, isPostRead } from "@/lib/types";
import ScoreInput from "./ScoreInput";
import DnfReasons from "./DnfReasons";
import { PepperRow } from "@/components/ui/PepperIcon";

// ── Response definitions ───────────────────────────

const PRE_READ_OPTIONS: { value: ReaderResponseType; emoji: string; label: string }[] = [
  { value: "must_read", emoji: "🔥", label: "Must Read" },
  { value: "on_the_shelf", emoji: "📚", label: "Shelf" },
  { value: "not_for_me", emoji: "🤷", label: "Pass" },
];

const POST_READ_OPTIONS: { value: ReaderResponseType; emoji: string; label: string }[] = [
  { value: "loved_it", emoji: "❤️", label: "Loved It" },
  { value: "it_was_fine", emoji: "👍", label: "Fine" },
  { value: "didnt_finish", emoji: "💬", label: "DNF" },
];

const RESPONSE_DNA_WEIGHTS: Record<ReaderResponseType, number> = {
  must_read: 0.3,
  on_the_shelf: 0.1,
  not_for_me: -0.5,
  loved_it: 1.0,
  it_was_fine: 0.7,
  didnt_finish: -0.9,
};

// ── Component ──────────────────────────────────────

interface ReaderResponseProps {
  bookId: string;
  bookTitle?: string;
}

export default function ReaderResponse({ bookId }: ReaderResponseProps) {
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [response, setResponse] = useState<ReaderResponseType | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [rating, setRating] = useState<UserRating | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { openSignIn } = useSignInModal();
  const supabase = createClient();

  // Load user + existing state
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      const uid = data.user.id;
      setUser({ id: uid });

      // Fetch response + rating in parallel
      Promise.all([
        supabase
          .from("reading_status")
          .select("response, is_reading")
          .eq("user_id", uid)
          .eq("book_id", bookId)
          .single(),
        supabase
          .from("user_ratings")
          .select("star_rating, score, spice_rating, note")
          .eq("user_id", uid)
          .eq("book_id", bookId)
          .single(),
      ]).then(([statusRes, ratingRes]) => {
        if (statusRes.data) {
          const r = statusRes.data.response as ReaderResponseType | null;
          setResponse(r);
          setIsReading(statusRes.data.is_reading as boolean);
          if (r && isPostRead(r)) setExpanded(true);
        }
        if (ratingRes.data) {
          setRating({
            starRating: ratingRes.data.star_rating ?? null,
            score: ratingRes.data.score != null ? parseFloat(ratingRes.data.score) : null,
            spiceRating: ratingRes.data.spice_rating ?? null,
            note: ratingRes.data.note ?? null,
          });
        }
      });
    });
  }, [bookId, supabase]);

  // ── Handlers ──────────────────────────────────

  const fireDnaSignal = useCallback(
    (resp: ReaderResponseType) => {
      fetch("/api/reading-dna/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId,
          signalType: "reader_response",
          weight: RESPONSE_DNA_WEIGHTS[resp],
        }),
      }).catch(() => {});
    },
    [bookId]
  );

  async function handleResponse(newResponse: ReaderResponseType) {
    if (!user) {
      openSignIn();
      return;
    }

    setSaving(true);
    const prevResponse = response;
    const prevIsReading = isReading;

    // Toggle: tapping active response deselects it
    const isDeselect = response === newResponse;

    if (isDeselect) {
      setResponse(null);
      setExpanded(false);
    } else {
      setResponse(newResponse);
      // Post-read clears is_reading, pre-read preserves it
      if (isPostRead(newResponse)) {
        setIsReading(false);
        setExpanded(true);
      } else {
        setExpanded(false);
      }
    }

    try {
      if (isDeselect) {
        await supabase
          .from("reading_status")
          .delete()
          .eq("user_id", user.id)
          .eq("book_id", bookId);
      } else {
        const statusMap: Record<ReaderResponseType, string> = {
          must_read: "want_to_read",
          on_the_shelf: "want_to_read",
          not_for_me: "want_to_read",
          loved_it: "read",
          it_was_fine: "read",
          didnt_finish: "read",
        };

        await supabase.from("reading_status").upsert(
          {
            user_id: user.id,
            book_id: bookId,
            status: statusMap[newResponse],
            response: newResponse,
            is_reading: isPostRead(newResponse) ? false : isReading,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,book_id" }
        );

        fireDnaSignal(newResponse);
      }
    } catch {
      // Rollback on error
      setResponse(prevResponse);
      setIsReading(prevIsReading);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleReading() {
    if (!user) {
      openSignIn();
      return;
    }

    const newIsReading = !isReading;
    setIsReading(newIsReading);

    try {
      const existing = await supabase
        .from("reading_status")
        .select("response")
        .eq("user_id", user.id)
        .eq("book_id", bookId)
        .single();

      if (existing.data) {
        await supabase
          .from("reading_status")
          .update({
            is_reading: newIsReading,
            status: newIsReading ? "reading" : (response && isPreRead(response) ? "want_to_read" : "read"),
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id)
          .eq("book_id", bookId);
      } else {
        await supabase.from("reading_status").insert({
          user_id: user.id,
          book_id: bookId,
          status: newIsReading ? "reading" : "want_to_read",
          response: "on_the_shelf",
          is_reading: newIsReading,
          updated_at: new Date().toISOString(),
        });
        if (!response) setResponse("on_the_shelf");
      }
    } catch {
      setIsReading(!newIsReading); // rollback
    }
  }

  async function handleScoreChange(score: number | null) {
    if (!user) return;

    setRating((prev) => ({
      starRating: score != null ? Math.round(score) : null,
      score,
      spiceRating: prev?.spiceRating ?? null,
      note: prev?.note ?? null,
    }));

    const payload: Record<string, unknown> = {
      user_id: user.id,
      book_id: bookId,
      updated_at: new Date().toISOString(),
    };

    if (score !== null) {
      payload.score = score;
      payload.star_rating = Math.round(score);
    } else {
      payload.score = null;
      payload.star_rating = null;
    }

    await supabase
      .from("user_ratings")
      .upsert(payload, { onConflict: "user_id,book_id" });
  }

  async function handleSpiceChange(level: number) {
    if (!user) return;

    const newLevel = rating?.spiceRating === level ? null : level;
    setRating((prev) => ({
      starRating: prev?.starRating ?? null,
      score: prev?.score ?? null,
      spiceRating: newLevel,
      note: prev?.note ?? null,
    }));

    if (newLevel !== null) {
      await supabase.from("user_ratings").upsert(
        {
          user_id: user.id,
          book_id: bookId,
          spice_rating: newLevel,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,book_id" }
      );
    }

    // Recompute DNA (spice affects preference, not signal weight)
    fetch("/api/reading-dna/recompute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recomputeOnly: true }),
    }).catch(() => {});
  }

  async function handleNoteChange(note: string) {
    if (!user) return;

    setRating((prev) => ({
      starRating: prev?.starRating ?? null,
      score: prev?.score ?? null,
      spiceRating: prev?.spiceRating ?? null,
      note,
    }));

    await supabase.from("user_ratings").upsert(
      {
        user_id: user.id,
        book_id: bookId,
        note: note.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,book_id" }
    );
  }

  // ── Render ────────────────────────────────────

  function renderResponseButton(
    opt: { value: ReaderResponseType; emoji: string; label: string },
    isActive: boolean
  ) {
    return (
      <button
        key={opt.value}
        type="button"
        onClick={() => handleResponse(opt.value)}
        disabled={saving}
        className={clsx(
          "flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-mono px-2 py-2.5 rounded-md border transition-colors min-h-[44px]",
          isActive
            ? "bg-fire text-white border-fire"
            : "bg-white text-muted border-border hover:border-fire/30 hover:text-ink",
          saving && "opacity-50"
        )}
      >
        <span>{opt.emoji}</span>
        <span>{opt.label}</span>
      </button>
    );
  }

  return (
    <div className="w-full space-y-3">
      <h3 className="text-xs font-mono text-muted uppercase tracking-wide">
        Your Take
      </h3>

      {/* Pre-read row */}
      <div className="flex gap-1.5">
        {PRE_READ_OPTIONS.map((opt) =>
          renderResponseButton(opt, response === opt.value)
        )}
      </div>

      {/* Reading toggle */}
      <button
        type="button"
        onClick={handleToggleReading}
        className={clsx(
          "w-full inline-flex items-center justify-center gap-1.5 text-xs font-mono px-2 py-2 rounded-md border transition-colors min-h-[44px]",
          isReading
            ? "bg-fire/10 text-fire border-fire/30"
            : "bg-white text-muted border-border hover:border-fire/30 hover:text-ink"
        )}
      >
        <span>📖</span>
        <span>Reading</span>
      </button>

      {/* Post-read row */}
      <div className="flex gap-1.5">
        {POST_READ_OPTIONS.map((opt) =>
          renderResponseButton(opt, response === opt.value)
        )}
      </div>

      {/* Expanded section (post-read active) */}
      {expanded && response && isPostRead(response) && (
        <div className="border-t border-border pt-3 space-y-4">
          {/* Score input */}
          <div>
            <p className="text-xs font-mono text-muted uppercase tracking-wide mb-2">
              Score (optional)
            </p>
            <ScoreInput
              value={rating?.score ?? null}
              onChange={handleScoreChange}
            />
          </div>

          {/* Spice rating (compact) */}
          <div>
            <p className="text-xs font-mono text-muted uppercase tracking-wide mb-2">
              Your spice take
            </p>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => handleSpiceChange(level)}
                  className={clsx(
                    "p-1.5 rounded transition-opacity min-w-[44px] min-h-[44px] flex items-center justify-center",
                    rating?.spiceRating != null && rating.spiceRating >= level
                      ? "opacity-100"
                      : "opacity-30 hover:opacity-60"
                  )}
                >
                  <PepperRow level={level} size={18} />
                </button>
              ))}
            </div>
          </div>

          {/* Private note */}
          <div>
            <p className="text-xs font-mono text-muted uppercase tracking-wide mb-2">
              Private note
            </p>
            <textarea
              value={rating?.note ?? ""}
              onChange={(e) => handleNoteChange(e.target.value)}
              placeholder="Your thoughts (only you can see this)"
              rows={2}
              className="w-full text-xs font-body border border-border rounded-lg px-3 py-2 bg-white text-ink placeholder:text-muted/40 focus:ring-2 focus:ring-fire/30 focus:border-fire/40 focus:outline-none resize-none"
            />
          </div>

          {/* DNF reasons (only for didnt_finish) */}
          {response === "didnt_finish" && user && (
            <DnfReasons bookId={bookId} userId={user.id} />
          )}
        </div>
      )}
    </div>
  );
}
