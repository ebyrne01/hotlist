"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSignInModal } from "@/lib/auth/useSignInModal";
import { createClient } from "@/lib/supabase/client";
import BookCover from "@/components/ui/BookCover";
import RatingBadge from "@/components/ui/RatingBadge";
import { PepperRow } from "@/components/ui/PepperIcon";
import type { BookDetail } from "@/lib/types";
import { ArrowRight, BadgeCheck, Users } from "lucide-react";

interface BookWithMention extends BookDetail {
  creatorSentiment: string | null;
  creatorQuote: string | null;
}

interface Props {
  creator: Record<string, unknown>;
  books: BookWithMention[];
}

export default function CreatorDiscoveryClient({ creator, books }: Props) {
  const { user } = useAuth();
  const { openSignIn } = useSignInModal();
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(creator.follower_count as number || 0);

  const handle = creator.handle as string;
  const platform = creator.platform as string;
  const grabCount = creator.grab_count as number || 0;
  const bookCount = creator.book_count as number || 0;
  const isClaimed = !!(creator.claimed_by);
  const [claimStatus, setClaimStatus] = useState<"idle" | "loading" | "submitted" | "error">("idle");
  const [claimError, setClaimError] = useState<string | null>(null);

  // Check follow status on load
  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    supabase
      .from("user_follows")
      .select("id")
      .eq("user_id", user.id)
      .eq("creator_handle_id", creator.id as string)
      .single()
      .then(({ data }) => {
        setIsFollowing(!!data);
      });
  }, [user, creator.id]);

  const [followLoading, setFollowLoading] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);

  async function toggleFollow() {
    if (!user) {
      openSignIn();
      return;
    }
    setFollowLoading(true);
    setFollowError(null);
    const supabase = createClient();
    const wasFollowing = isFollowing;

    // Optimistic update
    setIsFollowing(!wasFollowing);
    setFollowerCount((c) => wasFollowing ? Math.max(0, c - 1) : c + 1);

    try {
      if (wasFollowing) {
        const { error } = await supabase
          .from("user_follows")
          .delete()
          .eq("user_id", user.id)
          .eq("creator_handle_id", creator.id as string);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("user_follows").insert({
          user_id: user.id,
          creator_handle_id: creator.id as string,
        });
        if (error) throw error;
      }
    } catch {
      // Revert optimistic update
      setIsFollowing(wasFollowing);
      setFollowerCount((c) => wasFollowing ? c + 1 : Math.max(0, c - 1));
      setFollowError("Couldn't update. Try again.");
      setTimeout(() => setFollowError(null), 3000);
    } finally {
      setFollowLoading(false);
    }
  }

  // Top tropes across all books
  const tropeCounts = new Map<string, { name: string; slug: string; count: number }>();
  for (const book of books) {
    for (const trope of book.tropes) {
      const existing = tropeCounts.get(trope.slug);
      tropeCounts.set(trope.slug, {
        name: trope.name,
        slug: trope.slug,
        count: (existing?.count || 0) + 1,
      });
    }
  }
  const topTropes = Array.from(tropeCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12">
      {/* Header */}
      <section className="surface-parchment -mx-4 -mt-8 mb-8 border-b border-aged-gold/30 px-4 py-8 sm:mx-0 sm:mt-0 sm:rounded-3xl sm:border sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-fire">
              Creator shelf
            </p>
            <h1 className="mt-2 font-display text-4xl font-bold text-ink sm:text-5xl">
              {handle}
            </h1>
            <p className="mt-2 text-sm font-mono text-muted-a11y">
              {platform} · {bookCount} book{bookCount !== 1 ? "s" : ""} recommended · {grabCount} video{grabCount !== 1 ? "s" : ""} processed
            </p>
          </div>
          <button
            onClick={toggleFollow}
            disabled={followLoading}
            className={`min-h-[48px] rounded-lg px-5 py-3 text-sm font-mono transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fire disabled:opacity-40 ${
              isFollowing
                ? "bg-white border border-fire/25 text-fire hover:bg-fire/5"
                : "bg-fire text-white hover:bg-fire/90"
            }`}
          >
            {isFollowing ? "Following" : "Follow"}
          </button>
        </div>

        {followError && (
          <p className="text-xs text-red-600 font-body mt-1">{followError}</p>
        )}

        {followerCount > 0 && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-mono text-muted-a11y">
            <Users size={12} aria-hidden="true" />
            {followerCount} Hotlist {followerCount === 1 ? "reader" : "readers"} following
          </p>
        )}

        {isClaimed && (creator.vanity_slug as string) && (
          <Link
            href={`/${creator.vanity_slug as string}`}
            className="mt-3 inline-flex min-h-10 items-center gap-1 rounded-lg border border-fire/25 bg-white px-3 py-2 text-sm font-mono text-fire transition-colors hover:bg-fire/5"
          >
            <BadgeCheck size={14} aria-hidden="true" />
            Visit full profile
          </Link>
        )}

        {/* Top tropes */}
        {topTropes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {topTropes.map((t) => (
              <Link
                key={t.slug}
                href={`/tropes/${t.slug}`}
                className="inline-flex min-h-8 items-center rounded-full border border-aged-gold/40 bg-white/70 px-2.5 py-1 text-xs font-mono text-muted-a11y transition-colors hover:border-fire/30 hover:text-fire"
              >
                {t.name}
              </Link>
            ))}
          </div>
        )}

        {/* Claim banner */}
        {!isClaimed && claimStatus !== "submitted" && (
          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-fire/15 bg-white/70 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-body text-ink">
              Are you <span className="font-semibold">{handle}</span>?{" "}
              Claim this profile to customize it and see analytics.
            </p>
            <button
              onClick={async () => {
                if (!user) { openSignIn(); return; }
                setClaimStatus("loading");
                setClaimError(null);
                try {
                  const res = await fetch("/api/creators/claim", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ creator_handle_id: creator.id }),
                  });
                  if (!res.ok) {
                    const data = await res.json();
                    setClaimError(data.error || "Something went wrong.");
                    setClaimStatus("error");
                    return;
                  }
                  setClaimStatus("submitted");
                } catch {
                  setClaimError("Something went wrong. Please try again.");
                  setClaimStatus("error");
                }
              }}
              disabled={claimStatus === "loading"}
              className="min-h-11 shrink-0 rounded-lg bg-fire px-4 py-2 text-xs font-mono uppercase tracking-[0.14em] text-white transition-colors hover:bg-fire/90 disabled:opacity-40"
            >
              {claimStatus === "loading" ? "..." : "Claim"}
            </button>
          </div>
        )}
        {claimStatus === "submitted" && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-xs font-body text-green-700">
              Claim request submitted! We&apos;ll review it within 48 hours.
            </p>
          </div>
        )}
        {claimError && claimStatus === "error" && (
          <div className="mt-2 text-xs text-red-600 font-body">{claimError}</div>
        )}
      </section>

      {/* Book list */}
      {books.length === 0 ? (
        <div className="rounded-2xl border border-aged-gold/30 bg-white p-8 text-center shadow-sm">
          <p className="font-display text-2xl font-bold text-ink">
            No books found yet.
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-a11y font-body">
            This page updates when someone grabs one of {handle}&apos;s videos on Hotlist.
          </p>
          <Link
            href="/booktok"
            className="mt-5 inline-flex min-h-[48px] items-center gap-2 rounded-lg bg-fire px-5 py-3 text-sm font-mono text-white transition-colors hover:bg-fire/90"
          >
            Grab a video
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fire">
              Books recommended by {handle}
            </p>
            <h2 className="font-display text-2xl font-bold text-ink">
              Their shelf, decoded
            </h2>
          </div>
          {books.map((book) => {
            const grRating = book.ratings.find((r) => r.source === "goodreads");
            const spice = book.spice.find(
              (s) =>
                s.source === "romance_io" ||
                s.source === "hotlist_community" ||
                s.source === "goodreads_inference"
            );

            return (
              <div key={book.id} className="flex gap-3 rounded-2xl border border-aged-gold/30 bg-white p-3 shadow-sm transition-colors hover:border-fire/25">
                <Link href={`/book/${book.slug}`} className="min-h-[88px] shrink-0">
                  <BookCover
                    title={book.title}
                    coverUrl={book.coverUrl}
                    size="sm"
                    className="w-14 h-20 rounded"
                  />
                </Link>
                <div className="flex-1 min-w-0">
                  <Link href={`/book/${book.slug}`}>
                    <h3 className="text-sm font-display font-bold text-ink truncate hover:text-fire transition-colors">
                      {book.title}
                    </h3>
                  </Link>
                  <p className="text-xs font-body text-muted truncate">{book.author}</p>

                  <div className="flex items-center gap-3 mt-1">
                    {grRating?.rating && (
                      <RatingBadge
                        score={grRating.rating}
                        source="goodreads"
                        ratingCount={grRating.ratingCount}
                      />
                    )}
                    {spice && (
                      <PepperRow level={spice.spiceLevel} size={12} />
                    )}
                  </div>

                  {/* Creator quote */}
                  {book.creatorQuote && (
                    <p className="text-xs font-body text-muted/70 italic mt-1.5 line-clamp-2">
                      &ldquo;{book.creatorQuote}&rdquo;
                    </p>
                  )}

                  {/* Trope pills */}
                  {book.tropes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {book.tropes.slice(0, 3).map((t) => (
                        <Link
                          key={t.slug}
                          href={`/tropes/${t.slug}`}
                          className="inline-flex min-h-7 items-center rounded-full border border-border px-2 py-0.5 text-xs font-mono text-muted-a11y transition-colors hover:border-fire/30 hover:text-fire"
                        >
                          {t.name}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
