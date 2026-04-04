"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AddToHotlistPopover from "@/components/hotlists/AddToHotlistPopover";
import ReadingStatusButtons from "@/components/books/ReadingStatusButtons";
import RatingWidget from "@/components/books/RatingWidget";

interface BookDetailClientProps {
  section: "reading-status" | "add-to-hotlist" | "mobile-cta" | "enrichment-poller";
  bookId: string;
  bookTitle?: string;
  bookAuthor?: string;
  enrichmentStatus?: "pending" | "partial" | "complete" | null;
}

export default function BookDetailClient({
  section,
  bookId,
  bookTitle,
  bookAuthor,
  enrichmentStatus,
}: BookDetailClientProps) {
  switch (section) {
    case "reading-status":
      return <ReadingStatusWithToast bookId={bookId} bookTitle={bookTitle ?? "this book"} />;
    case "add-to-hotlist":
      return <AddToHotlistPopover bookId={bookId} variant="button" />;
    case "mobile-cta":
      return <AddToHotlistPopover bookId={bookId} variant="button" className="w-full" />;
    case "enrichment-poller":
      return (
        <EnrichmentPoller
          bookId={bookId}
          bookTitle={bookTitle ?? ""}
          bookAuthor={bookAuthor ?? ""}
          enrichmentStatus={enrichmentStatus ?? null}
        />
      );
  }
}

// ── Enrichment poller — triggers enrichment + polls for updates ──

function EnrichmentPoller({
  bookId,
  bookTitle,
  bookAuthor,
  enrichmentStatus,
}: {
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  enrichmentStatus: "pending" | "partial" | "complete" | null;
}) {
  const router = useRouter();

  useEffect(() => {
    // Fire-and-forget: trigger AI recommendations if not cached yet.
    // Current visit uses trope/author fallback; next visit gets AI recs.
    fetch("/api/books/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId }),
    }).catch(() => {});

    if (enrichmentStatus === "complete") return;

    // Trigger enrichment
    fetch("/api/books/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId, title: bookTitle, author: bookAuthor }),
    }).catch(() => {});

    // Poll for updates every 5 seconds
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/books/lookup?id=${bookId}`);
        const data = await res.json();
        if (data.found && (data.hasRatings || data.hasSpice || data.enrichmentStatus === "complete")) {
          router.refresh();
        }
      } catch {
        // Silently ignore polling errors
      }
    }, 5000);

    // Stop polling after 60 seconds
    const timeout = setTimeout(() => clearInterval(interval), 60_000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [enrichmentStatus, bookId, bookTitle, bookAuthor, router]);

  // No visible UI — this is a background poller
  return null;
}

// ── Reading Status + "Finished!" toast + RatingWidget ──

function ReadingStatusWithToast({
  bookId,
  bookTitle,
}: {
  bookId: string;
  bookTitle: string;
}) {
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [showFinishedToast, setShowFinishedToast] = useState(false);
  const [showNoteWidget, setShowNoteWidget] = useState(false);
  const [hasReadStatus, setHasReadStatus] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUser({ id: data.user.id });
        // Check if already marked as read (to show note widget)
        supabase
          .from("reading_status")
          .select("status")
          .eq("user_id", data.user.id)
          .eq("book_id", bookId)
          .single()
          .then(({ data: rs }) => {
            if (rs?.status === "read") {
              setHasReadStatus(true);
              setShowNoteWidget(true);
            }
          });
      }
    });
  }, [bookId, supabase]);

  function handleMarkedRead() {
    setShowFinishedToast(true);
    setHasReadStatus(true);
    // Auto-dismiss toast after 5 seconds
    setTimeout(() => setShowFinishedToast(false), 5000);
  }

  function handleRateNow() {
    setShowFinishedToast(false);
    setShowNoteWidget(true);
    // Scroll the star rating into view — it's in the InlineUserRating above
    const ratingRow = document.querySelector("[data-rating-row]");
    if (ratingRow) {
      ratingRow.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  return (
    <div className="w-full">
      <ReadingStatusButtons
        bookId={bookId}
        bookTitle={bookTitle}
        onMarkedRead={handleMarkedRead}
      />

      {/* "Finished!" toast */}
      {showFinishedToast && (
        <div className="mt-3 p-3 bg-white border border-fire/20 rounded-lg flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2">
          <p className="text-sm font-body text-ink">
            Finished <span className="font-semibold italic">{bookTitle}</span>!
            How was it?
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleRateNow}
              className="text-xs font-mono px-3 py-1.5 bg-fire text-white rounded-md hover:bg-fire/90 transition-colors"
            >
              Rate Now
            </button>
            <button
              onClick={() => {
                setShowFinishedToast(false);
                setShowNoteWidget(true);
              }}
              className="text-xs font-mono text-muted hover:text-ink transition-colors px-2 py-1.5"
            >
              Later
            </button>
          </div>
        </div>
      )}

      {/* Private note widget — shown when book is marked as Read */}
      {user && showNoteWidget && hasReadStatus && (
        <RatingWidget bookId={bookId} userId={user.id} />
      )}
    </div>
  );
}
