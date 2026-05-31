"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Headphones } from "lucide-react";

type LookupStatus = "idle" | "loading" | "found" | "none" | "quiet";

export default function SpotifyTrigger({
  bookId,
  showStatus = false,
}: {
  bookId: string;
  showStatus?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<LookupStatus>(
    showStatus ? "loading" : "quiet"
  );

  useEffect(() => {
    let cancelled = false;

    async function runLookup() {
      try {
        const res = await fetch("/api/books/spotify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookId }),
        });
        const data = (await res.json().catch(() => null)) as {
          status?: string;
          playlists?: unknown[] | null;
        } | null;

        if (cancelled) return;

        if (data?.status === "fetched" && data.playlists?.length) {
          setStatus("found");
          router.refresh();
          return;
        }

        if (data?.status === "fresh" && data.playlists?.length) {
          setStatus("found");
          router.refresh();
          return;
        }

        setStatus(showStatus ? "none" : "quiet");
      } catch {
        if (!cancelled) setStatus(showStatus ? "none" : "quiet");
      }
    }

    void runLookup();

    return () => {
      cancelled = true;
    };
  }, [bookId, router, showStatus]);

  if (!showStatus || status === "quiet" || status === "found") return null;

  return (
    <div className="rounded-3xl border border-aged-gold/30 bg-white p-4 shadow-sm">
      <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fire">
        <Headphones size={13} aria-hidden="true" />
        Reading soundtrack
      </p>
      {status === "loading" ? (
        <p className="mt-2 text-sm font-body text-muted-a11y">
          Looking for a reader-made Spotify soundtrack for this book...
        </p>
      ) : (
        <p className="mt-2 text-sm font-body text-muted-a11y">
          No strong Spotify match surfaced yet. We will keep checking as this book gets richer.
        </p>
      )}
    </div>
  );
}
