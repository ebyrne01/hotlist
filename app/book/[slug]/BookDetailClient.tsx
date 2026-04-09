"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AddToHotlistPopover from "@/components/hotlists/AddToHotlistPopover";
import ReaderResponse from "@/components/books/ReaderResponse";

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
      return <ReaderResponse bookId={bookId} bookTitle={bookTitle} />;
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
