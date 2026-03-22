/**
 * Search Spotify for playlists associated with a book.
 * Uses two query strategies and filters for relevance.
 */

import { getSpotifyToken } from "./client";

export interface SpotifyPlaylistResult {
  id: string;
  name: string;
  description: string | null;
  externalUrl: string;
  imageUrl: string | null;
  trackCount: number;
  ownerName: string;
  uri: string;
}

export async function searchBookPlaylists(
  title: string,
  author: string
): Promise<SpotifyPlaylistResult[]> {
  const token = await getSpotifyToken();

  // Two search strategies to catch official + fan playlists
  const queries = [
    `${title} playlist`,
    `${title} ${author}`,
  ];

  const results = new Map<string, SpotifyPlaylistResult>();
  const lowerTitle = title.toLowerCase();
  const authorLastName = author.split(" ").pop()?.toLowerCase() ?? "";

  for (const query of queries) {
    try {
      const res = await fetch(
        `https://api.spotify.com/v1/search?${new URLSearchParams({
          q: query,
          type: "playlist",
          limit: "8",
        })}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!res.ok) continue;

      const data = await res.json();
      for (const item of data.playlists?.items ?? []) {
        if (!item || results.has(item.id)) continue;

        // Skip very short playlists (likely not book playlists)
        if ((item.tracks?.total ?? 0) < 5) continue;

        const playlistName = (item.name ?? "").toLowerCase();

        // Relevance filter: playlist name must contain the book title or author last name
        const matchesTitle = playlistName.includes(lowerTitle);
        const matchesAuthor = authorLastName.length > 2 && playlistName.includes(authorLastName);
        if (!matchesTitle && !matchesAuthor) continue;

        results.set(item.id, {
          id: item.id,
          name: item.name,
          description: item.description || null,
          externalUrl: item.external_urls?.spotify ?? `https://open.spotify.com/playlist/${item.id}`,
          imageUrl: item.images?.[0]?.url ?? null,
          trackCount: item.tracks?.total ?? 0,
          ownerName: item.owner?.display_name ?? "Unknown",
          uri: item.uri,
        });
      }
    } catch (err) {
      console.warn("[spotify-search] Query failed:", err);
    }
  }

  // Rank: prefer playlists with the book title in the name, then by track count
  return Array.from(results.values())
    .sort((a, b) => {
      const aHasTitle = a.name.toLowerCase().includes(lowerTitle) ? 1 : 0;
      const bHasTitle = b.name.toLowerCase().includes(lowerTitle) ? 1 : 0;
      if (aHasTitle !== bHasTitle) return bHasTitle - aHasTitle;
      return b.trackCount - a.trackCount;
    })
    .slice(0, 3);
}
