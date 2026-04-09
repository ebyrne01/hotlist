"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSignInModal } from "@/lib/auth/useSignInModal";
import SpiceAttribution, { isEstimatedSource } from "@/components/books/SpiceAttribution";
import { PepperIcon, PepperRow } from "@/components/ui/PepperIcon";
import type { CompositeSpiceData } from "@/lib/types";

interface SpiceData {
  spiceLevel: number;
  source: "romance_io" | "hotlist_community" | "goodreads_inference";
  ratingCount: number | null;
  confidence?: "low" | "medium" | "high" | null;
}

interface SpiceSectionProps {
  bookId: string;
  compositeSpice: CompositeSpiceData | null;
  romanceIoSpice: SpiceData | null;
  romanceIoHeatLabel: string | null;
  romanceIoSlug: string | null;
  communitySpice: SpiceData | null;
  inferredSpice: SpiceData | null;
  compact?: boolean;
}

export default function SpiceSection({
  bookId,
  compositeSpice,
  romanceIoSpice,
  romanceIoHeatLabel,
  romanceIoSlug,
  communitySpice: initialCommunity,
  inferredSpice,
  compact: _compact = false,
}: SpiceSectionProps) {
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [userSpice, setUserSpice] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // Live community data that updates after user rates
  const [communitySpice, setCommunitySpice] = useState(initialCommunity);
  const { openSignIn } = useSignInModal();
  const supabase = createClient();

  // Determine primary spice source:
  // Use composite score when available, fall back to legacy sources
  const hasRomanceIo = !!romanceIoSpice;
  const hasCommunity =
    communitySpice && (communitySpice.ratingCount ?? 0) >= 5;

  // The "headline" spice level — prefer composite, fall back to legacy
  const primaryLevel = compositeSpice
    ? compositeSpice.score
    : hasRomanceIo
      ? romanceIoSpice.spiceLevel
      : hasCommunity
        ? communitySpice.spiceLevel
        : inferredSpice?.spiceLevel ?? null;

  // Is the composite score estimated (not community or romance.io)?
  const isEstimated = compositeSpice
    ? isEstimatedSource(compositeSpice.primarySource)
    : !hasRomanceIo && !hasCommunity;

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
      const prevUserSpice = userSpice;
      setUserSpice(value);
      setEditing(false);

      try {
        // Save to user_ratings
        await supabase.from("user_ratings").upsert(
          {
            user_id: user.id,
            book_id: bookId,
            spice_rating: value,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,book_id" }
        );

        // Auto-set reading status to "read" / "loved_it" if none set
        const { data: currentStatus } = await supabase
          .from("reading_status")
          .select("status, response")
          .eq("user_id", user.id)
          .eq("book_id", bookId)
          .single();

        if (!currentStatus) {
          await supabase.from("reading_status").upsert(
            {
              user_id: user.id,
              book_id: bookId,
              status: "read",
              response: "loved_it",
              is_reading: false,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id,book_id" }
          );
        }

        // Recalculate community spice aggregate from all user_ratings
        const { data: allRatings } = await supabase
          .from("user_ratings")
          .select("spice_rating")
          .eq("book_id", bookId)
          .not("spice_rating", "is", null);

        if (allRatings && allRatings.length > 0) {
          const total = allRatings.reduce(
            (sum, r) => sum + (r.spice_rating ?? 0),
            0
          );
          const mean = total / allRatings.length;
          // Match server-side rounding: one decimal place (community-aggregation.ts)
          const avg = Math.round(mean * 10) / 10;
          const count = allRatings.length;

          // Update book_spice community row (legacy)
          await supabase.from("book_spice").upsert(
            {
              book_id: bookId,
              source: "hotlist_community",
              spice_level: avg,
              rating_count: count,
              scraped_at: new Date().toISOString(),
            },
            { onConflict: "book_id,source" }
          );

          // Update local community spice state
          setCommunitySpice({
            spiceLevel: avg,
            source: "hotlist_community",
            ratingCount: count,
          });
        }

        // Trigger server-side community aggregation into spice_signals (fire-and-forget)
        fetch("/api/books/refresh-spice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookId }),
        }).catch(() => {/* non-blocking */});

        // Fire-and-forget: update Reading DNA signal
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
        setUserSpice(prevUserSpice);
      } finally {
        setSaving(false);
      }
    },
    [user, saving, userSpice, bookId, supabase]
  );

  // Build tooltip text based on what data sources are showing
  const tooltipText = hasRomanceIo
    ? `Spice rating from romance.io — rated by thousands of romance readers. Heat level: ${romanceIoHeatLabel ?? "Unknown"}.`
    : hasCommunity
      ? `Rated by ${communitySpice.ratingCount} Hotlist reader${(communitySpice.ratingCount ?? 0) === 1 ? "" : "s"}.`
      : "Estimated from how readers shelve this book on Goodreads (e.g. 'steamy', 'clean-romance'). Add your rating to improve it.";

  // Spice difference for "your experience may vary" note
  // Compare against romance.io first, then community, then inferred
  const referenceLevel = hasRomanceIo
    ? romanceIoSpice.spiceLevel
    : hasCommunity
      ? communitySpice.spiceLevel
      : inferredSpice?.spiceLevel ?? null;
  const spiceDifference =
    userSpice > 0 && referenceLevel
      ? Math.abs(userSpice - referenceLevel)
      : 0;

  // romance.io URL — only use direct link if slug has the full id/slug path
  const romanceIoUrl = romanceIoSlug && romanceIoSlug.includes("/")
    ? `https://www.romance.io/books/${romanceIoSlug}`
    : null;

  return (
    <div>
      {/* Header with tooltip */}
      <h2 className="text-xs font-mono text-muted-a11y uppercase tracking-wide mb-2 flex items-center gap-1.5">
        Spice Level
        <span className="relative group/tip cursor-help">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-muted-a11y"
          >
            <circle cx="8" cy="8" r="7" />
            <path d="M8 11V8M8 5.5V5" strokeLinecap="round" />
          </svg>
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2.5 bg-ink text-white text-xs font-body leading-snug rounded-lg shadow-lg opacity-0 group-hover/tip:opacity-100 pointer-events-none transition-opacity z-20 normal-case tracking-normal">
            {tooltipText}
          </span>
        </span>
      </h2>

      {/* Primary spice indicator */}
      <div className="flex items-center gap-2">
        <PepperRow level={primaryLevel} size={18} estimated={isEstimated} />
        {hasRomanceIo && romanceIoHeatLabel && (
          <span className="text-xs font-body text-muted-a11y italic">
            {romanceIoHeatLabel}
          </span>
        )}
      </div>

      {/* Source attribution — composite-aware */}
      {compositeSpice ? (
        <div className="mt-1.5">
          <SpiceAttribution
            composite={compositeSpice}
            romanceIoSlug={romanceIoSlug}
          />
        </div>
      ) : hasRomanceIo && romanceIoUrl ? (
        <a
          href={romanceIoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-xs font-mono text-fire/80 hover:text-fire transition-colors"
        >
          romance.io
          <ExternalLink size={10} />
        </a>
      ) : hasCommunity ? (
        <p className="mt-1.5 text-xs font-mono text-muted-a11y">
          Rated by {communitySpice.ratingCount} Hotlist reader
          {(communitySpice.ratingCount ?? 0) === 1 ? "" : "s"}
        </p>
      ) : inferredSpice ? (
        <p className="mt-1.5 text-xs font-mono text-muted-a11y">
          Estimated from Goodreads reader shelves
        </p>
      ) : null}

      {/* Community row when romance.io is primary and community has enough ratings */}
      {hasRomanceIo && hasCommunity && (
        <div className="mt-2 flex items-center gap-2 text-xs font-mono text-muted-a11y">
          <span>Hotlist readers:</span>
          <PepperRow level={communitySpice.spiceLevel} size={16} muted />
          <span className="text-xs">
            ({communitySpice.ratingCount} rating
            {(communitySpice.ratingCount ?? 0) === 1 ? "" : "s"})
          </span>
        </div>
      )}

      {/* If no romance.io but we have both community and inferred, show secondary */}
      {!hasRomanceIo && communitySpice && inferredSpice && (
        <div className="mt-2 flex items-center gap-2 text-xs font-mono text-muted-a11y">
          <span>Goodreads estimate:</span>
          <PepperRow level={inferredSpice.spiceLevel} size={16} muted />
        </div>
      )}

      {/* "Rate the spice" nudge for estimated sources */}
      {isEstimated && !userSpice && authChecked && (
        <p className="mt-1.5 text-xs font-mono text-fire/70 italic">
          This is an estimate — rate the spice below to improve it
        </p>
      )}

      {/* User's spice rating section */}
      {authChecked && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <UserSpiceRow
            user={user}
            userSpice={userSpice}
            editing={editing}
            saving={saving}
            justSaved={justSaved}
            spiceDifference={spiceDifference}
            onEdit={() => setEditing(true)}
            onSave={saveSpice}
            onSignIn={() => openSignIn()}
          />
        </div>
      )}
    </div>
  );
}

// ── Helper: user spice rating row ───────────────────

function UserSpiceRow({
  user,
  userSpice,
  editing,
  saving,
  justSaved,
  spiceDifference,
  onEdit,
  onSave,
  onSignIn,
}: {
  user: { id: string } | null;
  userSpice: number;
  editing: boolean;
  saving: boolean;
  justSaved: boolean;
  spiceDifference: number;
  onEdit: () => void;
  onSave: (value: number) => void;
  onSignIn: () => void;
}) {
  // Logged out
  if (!user) {
    return (
      <button
        onClick={onSignIn}
        className="text-xs font-mono text-fire/70 hover:text-fire transition-colors"
      >
        How spicy did you find it? Sign in &rarr;
      </button>
    );
  }

  // Just saved
  if (justSaved) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted-a11y">Your take:</span>
        <span className="inline-flex items-center gap-1 text-xs font-mono text-green-600">
          <Check size={12} strokeWidth={3} /> Saved
        </span>
      </div>
    );
  }

  // Rated, not editing
  if (userSpice > 0 && !editing) {
    return (
      <div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-a11y">
            Your take:
          </span>
          <PepperRow level={userSpice} size={16} />
          <button
            onClick={onEdit}
            className="text-xs font-mono text-fire/70 hover:text-fire transition-colors ml-1"
          >
            Edit
          </button>
        </div>
        {spiceDifference >= 2 && (
          <p className="mt-1.5 text-xs font-body text-muted-a11y italic">
            Spice is personal — your experience may vary
          </p>
        )}
      </div>
    );
  }

  // Unrated or editing: interactive chilies
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-mono text-muted-a11y">Your take:</span>
      <span className="inline-flex items-center gap-0.5">
        {Array.from({ length: 5 }, (_, i) => (
          <button
            key={i}
            type="button"
            disabled={saving}
            onClick={() => onSave(i + 1)}
            className="transition-transform cursor-pointer hover:scale-125"
          >
            <PepperIcon filled={i < userSpice} size={16} />
          </button>
        ))}
      </span>
    </div>
  );
}
