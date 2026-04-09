"use client";

import { useState } from "react";
import Image from "next/image";
import type { SpotifyPlaylistResult } from "@/lib/types";

interface Props {
  spotifyPlaylists: SpotifyPlaylistResult[] | null;
  booktrackPrompt: string | null;
  booktrackMoods: string[] | null;
  bookTitle: string;
}

/** Spotify logo as inline SVG — green circle with sound waves */
function SpotifyLogo({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="#1DB954"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Spotify"
    >
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

export default function BooktrackSection({
  spotifyPlaylists,
  booktrackPrompt,
  booktrackMoods,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [showEmbed, setShowEmbed] = useState(true);

  const hasPlaylists = spotifyPlaylists && spotifyPlaylists.length > 0;
  const hasVibes = !!booktrackPrompt;

  if (!hasPlaylists && !hasVibes) return null;

  const topPlaylist = spotifyPlaylists?.[0] ?? null;

  function handleCopyAndOpen() {
    if (!booktrackPrompt) return;
    navigator.clipboard.writeText(booktrackPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-3">
        <span className="font-display text-lg font-bold text-ink flex items-center gap-1.5">
          <SpotifyLogo size={18} />
          Booktrack
        </span>
        <p className="text-xs font-mono text-muted mt-0.5">Listen while you read</p>
      </div>

      {/* Mood tags */}
      {booktrackMoods && booktrackMoods.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {booktrackMoods.map((mood) => (
            <span
              key={mood}
              className="text-[10px] font-mono text-muted/70 px-2 py-0.5 border border-border/60 rounded-full bg-white"
            >
              {mood}
            </span>
          ))}
        </div>
      )}

      {/* Existing Spotify playlist */}
      {topPlaylist && (
        <div className="mb-3">
          <button
            onClick={() => setShowEmbed(!showEmbed)}
            className="w-full flex items-center gap-3 p-2.5 bg-white border border-border rounded-lg hover:border-fire/30 transition-colors text-left"
          >
            {topPlaylist.imageUrl && (
              <Image
                src={topPlaylist.imageUrl}
                alt=""
                width={48}
                height={48}
                className="rounded shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-body text-ink font-medium truncate">
                {topPlaylist.name}
              </p>
              <p className="text-xs font-mono text-muted/70">
                {topPlaylist.trackCount} songs · {topPlaylist.ownerName}
              </p>
            </div>
            <span className="text-xs font-mono text-[#1DB954] shrink-0">
              {showEmbed ? "Hide" : "Play"}
            </span>
          </button>

          {/* Spotify embed player */}
          {showEmbed && (
            <div className="mt-2 rounded-xl overflow-hidden">
              <iframe
                src={`https://open.spotify.com/embed/playlist/${topPlaylist.id}?utm_source=generator&theme=0`}
                width="100%"
                height="152"
                frameBorder="0"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                loading="lazy"
                className="rounded-xl"
              />
            </div>
          )}

          {/* More playlists */}
          {spotifyPlaylists && spotifyPlaylists.length > 1 && (
            <div className="mt-2 flex flex-col gap-1">
              {spotifyPlaylists.slice(1).map((pl) => (
                <a
                  key={pl.id}
                  href={pl.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-muted/60 hover:text-fire transition-colors truncate"
                  title={pl.name}
                >
                  + {pl.name}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AI-generated vibes prompt */}
      {hasVibes && (
        <div className="bg-cream/50 border border-border/50 rounded-lg p-3">
          <p className="text-xs font-mono text-muted/60 mb-1.5">
            {hasPlaylists ? "Or create your own" : "Create a custom playlist"}
          </p>
          <p className="text-sm font-body text-ink/80 italic leading-relaxed">
            &ldquo;{booktrackPrompt}&rdquo;
          </p>
          <div className="flex items-center gap-2 mt-2.5">
            <button
              onClick={handleCopyAndOpen}
              className="inline-flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-full border border-[#1DB954]/30 text-[#1DB954] hover:bg-[#1DB954]/5 transition-colors"
            >
              {copied ? (
                <>&#10003; Copied!</>
              ) : (
                <>
                  <SpotifyLogo size={12} />
                  Copy prompt
                </>
              )}
            </button>
            <a
              href="https://open.spotify.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-full bg-[#1DB954] text-white hover:bg-[#1ed760] transition-colors"
            >
              Open Spotify
            </a>
          </div>
          <p className="text-[10px] font-mono text-muted/40 mt-2">
            Paste into Spotify&apos;s Prompted Playlists (Premium) to generate a custom soundtrack
          </p>
        </div>
      )}
    </div>
  );
}
