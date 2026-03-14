"use client";

import Link from "next/link";
import BookCover from "@/components/ui/BookCover";

// ── Types ──────────────────────────────────────────────────────────

interface ProfileData {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  creatorVerifiedAt: string | null;
  tiktokHandle: string | null;
  instagramHandle: string | null;
  youtubeHandle: string | null;
  blogUrl: string | null;
}

interface HotlistCard {
  id: string;
  name: string;
  shareSlug: string;
  bookCount: number;
  updatedAt: string;
  sourceVideoUrl: string | null;
  sourceVideoThumbnail: string | null;
  covers: { coverUrl: string | null; title: string }[];
}

interface ReadingStats {
  booksRead: number;
  avgSpice: number | null;
  topTropes: { name: string; slug: string }[];
  mentionCount: number;
}

interface Props {
  profile: ProfileData;
  hotlists: HotlistCard[];
  stats: ReadingStats;
}

// ── Helpers ────────────────────────────────────────────────────────

function spicePeppers(avgSpice: number): string {
  const rounded = Math.round(avgSpice);
  const clamped = Math.max(1, Math.min(5, rounded));
  return Array.from({ length: clamped }, () => "\u{1F336}\u{FE0F}").join("");
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Component ──────────────────────────────────────────────────────

export default function CreatorProfileClient({ profile, hotlists, stats }: Props) {
  const hasSocialLinks =
    profile.tiktokHandle || profile.instagramHandle || profile.youtubeHandle || profile.blogUrl;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 mb-6">
        {profile.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt={profile.displayName}
            className="w-16 h-16 rounded-full object-cover border-2 border-border"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-fire text-cream flex items-center justify-center text-xl font-mono font-bold shrink-0">
            {initials(profile.displayName)}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display text-2xl font-bold text-ink">
              {profile.displayName}
            </h1>
            {profile.creatorVerifiedAt && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-fire/10 text-fire text-xs font-mono rounded-full shrink-0">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="shrink-0"
                >
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
                Verified Creator
              </span>
            )}
          </div>
          {profile.bio && (
            <p className="text-sm text-muted mt-1 line-clamp-3">{profile.bio}</p>
          )}
        </div>
      </div>

      {/* ── Social links ──────────────────────────────────────── */}
      {hasSocialLinks && (
        <div className="flex flex-wrap gap-3 mb-6">
          {profile.tiktokHandle && (
            <a
              href={`https://www.tiktok.com/${profile.tiktokHandle.startsWith("@") ? profile.tiktokHandle : `@${profile.tiktokHandle}`}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-mono text-muted hover:text-fire transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.51a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.87a8.28 8.28 0 004.76 1.5V6.93a4.84 4.84 0 01-1-.24z" />
              </svg>
              TikTok
            </a>
          )}
          {profile.instagramHandle && (
            <a
              href={`https://www.instagram.com/${profile.instagramHandle.replace(/^@/, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-mono text-muted hover:text-fire transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
              </svg>
              Instagram
            </a>
          )}
          {profile.youtubeHandle && (
            <a
              href={`https://www.youtube.com/${profile.youtubeHandle.startsWith("@") ? profile.youtubeHandle : `@${profile.youtubeHandle}`}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-mono text-muted hover:text-fire transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
              YouTube
            </a>
          )}
          {profile.blogUrl && (
            <a
              href={profile.blogUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-mono text-muted hover:text-fire transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
              </svg>
              Blog
            </a>
          )}
        </div>
      )}

      {/* ── Stats row ─────────────────────────────────────────── */}
      {(stats.booksRead > 0 || stats.avgSpice !== null || stats.topTropes.length > 0) && (
        <div className="font-mono text-xs text-muted mb-8">
          <span>
            {stats.booksRead > 0 && (
              <>{stats.booksRead} book{stats.booksRead !== 1 ? "s" : ""} read</>
            )}
            {stats.avgSpice !== null && (
              <>
                {stats.booksRead > 0 ? " · " : ""}
                Average spice: {spicePeppers(stats.avgSpice)}
              </>
            )}
            {stats.topTropes.length > 0 && (
              <>
                {(stats.booksRead > 0 || stats.avgSpice !== null) ? " · " : ""}
                Top tropes:{" "}
                {stats.topTropes.map((t, i) => (
                  <span key={t.slug}>
                    {i > 0 && ", "}
                    <Link
                      href={`/tropes/${t.slug}`}
                      className="text-fire hover:underline"
                    >
                      {t.name}
                    </Link>
                  </span>
                ))}
              </>
            )}
          </span>
        </div>
      )}

      {/* ── BookTok mentions ──────────────────────────────────── */}
      {stats.mentionCount > 0 && (
        <p className="text-xs font-mono text-muted/70 mb-6">
          Featured in {stats.mentionCount} BookTok video{stats.mentionCount !== 1 ? "s" : ""}
        </p>
      )}

      {/* ── Hotlists grid ─────────────────────────────────────── */}
      <h2 className="text-xs font-mono text-muted uppercase tracking-wide mb-4">
        Public Hotlists
      </h2>

      {hotlists.length === 0 ? (
        <p className="text-sm text-muted font-body">No public hotlists yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {hotlists.map((hotlist) => (
            <Link
              key={hotlist.id}
              href={`/lists/${hotlist.shareSlug}`}
              className="block p-4 bg-white border border-border rounded-lg hover:border-fire/30 transition-colors group"
            >
              {/* List name + book count */}
              <h3 className="font-display font-semibold text-ink group-hover:text-fire transition-colors truncate">
                {hotlist.name}
              </h3>
              <p className="text-xs font-mono text-muted mt-0.5">
                {hotlist.bookCount} book{hotlist.bookCount !== 1 ? "s" : ""} · {formatDate(hotlist.updatedAt)}
              </p>

              {/* Mini overlapping book covers */}
              {hotlist.covers.length > 0 && (
                <div className="flex items-center mt-3 -space-x-3 relative">
                  {hotlist.covers.map((cover, i) => (
                    <div
                      key={i}
                      className="relative"
                      style={{ zIndex: hotlist.covers.length - i }}
                    >
                      <BookCover
                        title={cover.title}
                        coverUrl={cover.coverUrl}
                        size="sm"
                        className="w-10 h-[60px] rounded shadow-sm border border-white"
                      />
                    </div>
                  ))}

                  {/* Video icon overlay if sourced from a video */}
                  {hotlist.sourceVideoUrl && (
                    <div className="ml-2 w-6 h-6 rounded-full bg-ink/70 flex items-center justify-center shrink-0">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="white"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  )}
                </div>
              )}

              {/* Video thumbnail if available */}
              {hotlist.sourceVideoThumbnail && (
                <div className="mt-3 relative rounded overflow-hidden">
                  <img
                    src={hotlist.sourceVideoThumbnail}
                    alt={`Video for ${hotlist.name}`}
                    className="w-full h-20 object-cover rounded"
                  />
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                    <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="#12080a">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
