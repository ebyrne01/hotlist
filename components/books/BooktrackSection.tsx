"use client";

import { useState } from "react";
import Image from "next/image";
import { Copy, ExternalLink, Headphones, Sparkles } from "lucide-react";
import type { SpotifyPlaylistResult } from "@/lib/types";

interface Props {
  spotifyPlaylists: SpotifyPlaylistResult[] | null;
  booktrackPrompt: string | null;
  booktrackMoods: string[] | null;
  bookTitle: string;
}

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

function cleanPrompt(prompt: string, bookTitle: string) {
  return prompt
    .replace(new RegExp(`^Create a playlist called ${escapeRegExp(bookTitle)}\\.\\s*`, "i"), "")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default function BooktrackSection({
  spotifyPlaylists,
  booktrackPrompt,
  booktrackMoods,
  bookTitle,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(
    spotifyPlaylists?.[0]?.id ?? null
  );

  const hasPlaylists = !!spotifyPlaylists?.length;
  const hasVibes = !!booktrackPrompt;

  if (!hasPlaylists && !hasVibes) return null;

  const topPlaylist = spotifyPlaylists?.[0] ?? null;
  const activePlaylist =
    spotifyPlaylists?.find((playlist) => playlist.id === activePlaylistId) ??
    topPlaylist;
  const promptBody =
    booktrackPrompt && cleanPrompt(booktrackPrompt, bookTitle);

  async function copyPrompt() {
    if (!booktrackPrompt) return;
    await navigator.clipboard.writeText(booktrackPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function copyPromptAndOpenSpotify() {
    await copyPrompt();
    window.open("https://open.spotify.com", "_blank", "noopener,noreferrer");
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-aged-gold/30 bg-[#171014] text-cream shadow-sm">
      <div className="relative p-4 sm:p-5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(212,67,14,0.3),transparent_45%),radial-gradient(circle_at_bottom_left,rgba(184,134,11,0.18),transparent_42%)]" />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-aged-gold">
                <Headphones size={13} aria-hidden="true" />
                Reading soundtrack
              </p>
              <h2 className="mt-1 font-display text-2xl font-bold text-cream">
                Listen while you read
              </h2>
            </div>
            <span className="inline-flex min-h-9 items-center gap-1 rounded-full border border-[#1DB954]/30 bg-[#1DB954]/10 px-3 text-xs font-mono text-[#7AF0A0]">
              <SpotifyLogo size={13} />
              Spotify
            </span>
          </div>

          {booktrackMoods && booktrackMoods.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {booktrackMoods.slice(0, 5).map((mood) => (
                <span
                  key={mood}
                  className="inline-flex min-h-9 items-center rounded-full border border-cream/10 bg-cream/10 px-3 text-[11px] font-mono uppercase tracking-[0.08em] text-cream/80"
                >
                  {mood}
                </span>
              ))}
            </div>
          )}

          {promptBody && (
            <p className="mt-4 max-w-2xl text-sm font-body leading-6 text-cream/80">
              {promptBody}
            </p>
          )}
        </div>
      </div>

      {activePlaylist && (
        <div className="border-t border-cream/10 bg-black/18 p-3 sm:p-4">
          <button
            onClick={() => setActivePlaylistId(activePlaylist.id)}
            className="flex w-full items-center gap-3 rounded-2xl border border-cream/10 bg-cream/10 p-3 text-left transition-colors hover:border-[#1DB954]/40"
          >
            {activePlaylist.imageUrl ? (
              <Image
                src={activePlaylist.imageUrl}
                alt=""
                width={64}
                height={64}
                className="h-16 w-16 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-cream/10">
                <SpotifyLogo size={24} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#7AF0A0]">
                Best match
              </p>
              <p className="truncate font-display text-lg font-bold text-cream">
                {activePlaylist.name}
              </p>
              <p className="mt-0.5 truncate text-xs font-mono text-cream/55">
                {activePlaylist.trackCount} songs by {activePlaylist.ownerName}
              </p>
              {activePlaylist.matchReason && (
                <p className="mt-1 text-[11px] font-body text-cream/55">
                  {activePlaylist.matchReason}
                </p>
              )}
            </div>
          </button>

          <div className="mt-3 overflow-hidden rounded-2xl border border-cream/10 bg-black/20">
            <iframe
              src={`https://open.spotify.com/embed/playlist/${activePlaylist.id}?utm_source=generator&theme=0`}
              width="100%"
              height="152"
              frameBorder="0"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              className="block rounded-2xl"
            />
          </div>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <a
              href={activePlaylist.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#1DB954] px-4 text-sm font-mono text-white transition-colors hover:bg-[#1ed760]"
            >
              Open in Spotify
              <ExternalLink size={14} aria-hidden="true" />
            </a>
            {booktrackPrompt && (
              <button
                onClick={copyPrompt}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-cream/10 bg-cream/10 px-4 text-sm font-mono text-cream transition-colors hover:bg-cream/15"
              >
                {copied ? "Prompt copied" : "Copy soundtrack prompt"}
                <Copy size={14} aria-hidden="true" />
              </button>
            )}
          </div>

          {spotifyPlaylists && spotifyPlaylists.length > 1 && (
            <div className="mt-4">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-cream/45">
                Alternate vibes
              </p>
              <div className="grid gap-2">
                {spotifyPlaylists.slice(1).map((playlist) => (
                  <button
                    key={playlist.id}
                    onClick={() => setActivePlaylistId(playlist.id)}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-cream/10 bg-cream/5 px-3 py-2 text-left text-sm font-body text-cream/80 transition-colors hover:border-[#1DB954]/35 hover:text-cream"
                  >
                    <span className="truncate">{playlist.name}</span>
                    <span className="shrink-0 text-xs font-mono text-cream/45">
                      {playlist.trackCount} songs
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!activePlaylist && hasVibes && (
        <div className="border-t border-cream/10 bg-black/18 p-4">
          <div className="rounded-2xl border border-cream/10 bg-cream/10 p-4">
            <p className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-aged-gold">
              <Sparkles size={13} aria-hidden="true" />
              Build the vibe
            </p>
            <p className="mt-2 text-sm font-body leading-6 text-cream/75">
              No strong reader playlist surfaced yet, but this soundtrack prompt is tuned to the book&apos;s mood.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={copyPromptAndOpenSpotify}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#1DB954] px-4 text-sm font-mono text-white transition-colors hover:bg-[#1ed760]"
              >
                {copied ? "Prompt copied" : "Copy prompt & open Spotify"}
                <ExternalLink size={14} aria-hidden="true" />
              </button>
              <button
                onClick={copyPrompt}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-cream/10 bg-cream/10 px-4 text-sm font-mono text-cream transition-colors hover:bg-cream/15"
              >
                Copy only
                <Copy size={14} aria-hidden="true" />
              </button>
            </div>
            <p className="mt-3 text-[11px] font-mono leading-5 text-cream/45">
              Paste the copied prompt into Spotify&apos;s AI Playlist flow. It is
              Premium/mobile gated, so Hotlist keeps this one-tap handoff until
              direct playlist creation is connected.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
