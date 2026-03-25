/**
 * Search Spotify for playlists associated with a book.
 * Uses two query strategies and filters for relevance.
 */

import { getSpotifyToken } from "./client";

// Rate limiter: ensure at least 5s between Spotify search calls.
// Spotify's API enforces a rolling window — being too aggressive
// triggers 429s with 75,000+ second retry-after headers.
let lastCallTime = 0;
async function rateLimit() {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < 5000) {
    await new Promise((r) => setTimeout(r, 5000 - elapsed));
  }
  lastCallTime = Date.now();
}

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
  await rateLimit();
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

  let successfulQueries = 0;

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    // Delay between queries to avoid rate limits
    if (i > 0) await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(
        `https://api.spotify.com/v1/search?${new URLSearchParams({
          q: query,
          type: "playlist",
          limit: "10",
        })}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        throw new Error(`Spotify rate limited (retry after ${retryAfter ?? "?"}s)`);
      }
      if (res.status === 401) {
        throw new Error("Spotify token expired or invalid");
      }
      if (!res.ok) continue;

      successfulQueries++;
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
      // Re-throw rate limit and auth errors so the enrichment worker retries
      if (err instanceof Error && (err.message.includes("rate limit") || err.message.includes("token"))) throw err;
      console.warn("[spotify-search] Query failed:", err);
    }
  }

  // If zero queries succeeded (all errored with non-fatal errors), throw so
  // the caller knows this wasn't a legitimate "no playlists found" result
  if (successfulQueries === 0) {
    throw new Error("Spotify search failed: no queries succeeded");
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
