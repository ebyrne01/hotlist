"use client";

import { useEffect } from "react";

/**
 * Fire-and-forget Spotify playlist lookup.
 * Renders nothing — just triggers the on-demand API when
 * a book has no playlists cached yet.
 */
export default function SpotifyTrigger({
  bookId,
  title,
  author,
}: {
  bookId: string;
  title: string;
  author: string;
}) {
  useEffect(() => {
    fetch("/api/books/spotify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId, title, author }),
    }).catch(() => {});
  }, [bookId, title, author]);

  return null;
}
