"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Headphones } from "lucide-react";

type LookupStatus = "idle" | "loading" | "found" | "none" | "quiet";

export default function SpotifyTrigger({
  bookId,
  bookTitle,
  bookAuthor,
  showStatus = false,
}: {
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
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

  const spotifySearchUrl = `https://open.spotify.com/search/${encodeURIComponent(
    `${bookTitle} ${bookAuthor}`
  )}/playlists`;

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
        <div className="mt-2">
          <p className="text-sm font-body leading-6 text-muted-a11y">
            No strong Spotify match surfaced yet. We will keep checking as this
            book gets richer, but you can search Spotify now if you want music
            for the mood.
          </p>
          <a
            href={spotifySearchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border border-fire/25 bg-fire/5 px-4 py-2 text-xs font-mono uppercase tracking-[0.14em] text-fire transition-colors hover:bg-fire/10"
          >
            Search Spotify playlists
          </a>
        </div>
      )}
    </div>
  );
}
