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

  // Strip series suffix like "(The Empyrean, #1)" from title
  const cleanTitle = title.replace(/\s*\(.*#\d+\)$/, "").replace(/\s*\(.*Series\)$/i, "").trim();

  // Two search strategies to catch official + fan playlists
  const queries = [
    `${cleanTitle} playlist`,
    `${cleanTitle} ${author}`,
  ];

  const results = new Map<string, SpotifyPlaylistResult>();
  const lowerTitle = cleanTitle.toLowerCase();
  const authorLastName = author.split(" ").pop()?.toLowerCase() ?? "";

  // Extract significant words from title (3+ chars, skip common words)
  const stopWords = new Set(["the", "and", "for", "with", "from", "that", "this", "book"]);
  const titleWords = lowerTitle
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  for (const query of queries) {
    try {
      const res = await fetch(
        `https://api.spotify.com/v1/search?${new URLSearchParams({
          q: query,
          type: "playlist",
          limit: "10",
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
        const playlistDesc = (item.description ?? "").toLowerCase();
        const searchText = `${playlistName} ${playlistDesc}`;

        // Relevance filter: check full title, significant title words, or author last name
        const matchesFullTitle = searchText.includes(lowerTitle);
        const matchingWords = titleWords.filter((w) => searchText.includes(w));
        const matchesTitleWords = titleWords.length > 0 && matchingWords.length >= Math.min(titleWords.length, 2);
        const matchesAuthor = authorLastName.length > 2 && searchText.includes(authorLastName);
        if (!matchesFullTitle && !matchesTitleWords && !matchesAuthor) continue;

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

  // Rank: prefer playlists with the full book title in the name, then word matches, then track count
  return Array.from(results.values())
    .sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      // Full title match in name is best
      const aFullTitle = aName.includes(lowerTitle) ? 2 : 0;
      const bFullTitle = bName.includes(lowerTitle) ? 2 : 0;
      if (aFullTitle !== bFullTitle) return bFullTitle - aFullTitle;
      // Then prefer more title word matches
      const aWords = titleWords.filter((w) => aName.includes(w)).length;
      const bWords = titleWords.filter((w) => bName.includes(w)).length;
      if (aWords !== bWords) return bWords - aWords;
      return b.trackCount - a.trackCount;
    })
    .slice(0, 3);
}
