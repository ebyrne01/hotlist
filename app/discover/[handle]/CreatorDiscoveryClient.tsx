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
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-ink">
              {handle}
            </h1>
            <p className="text-sm font-mono text-muted mt-1">
              {platform} · {bookCount} book{bookCount !== 1 ? "s" : ""} recommended · {grabCount} video{grabCount !== 1 ? "s" : ""} processed
            </p>
          </div>
          <button
            onClick={toggleFollow}
            disabled={followLoading}
            className={`px-4 py-2 rounded-lg text-xs font-mono transition-colors shrink-0 disabled:opacity-40 ${
              isFollowing
                ? "bg-cream border border-border text-muted hover:border-fire"
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
          <p className="text-xs font-mono text-muted/70 mt-2">
            {followerCount} Hotlist {followerCount === 1 ? "reader" : "readers"} following
          </p>
        )}

        {isClaimed && (creator.vanity_slug as string) && (
          <Link
            href={`/${creator.vanity_slug as string}`}
            className="inline-flex items-center gap-1 text-sm font-mono text-fire hover:text-fire/80 transition-colors mt-2"
          >
            Visit full profile &rarr;
          </Link>
        )}

        {/* Top tropes */}
        {topTropes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {topTropes.map((t) => (
              <Link
                key={t.slug}
                href={`/tropes/${t.slug}`}
                className="text-xs font-mono text-muted/70 px-2 py-0.5 border border-border rounded-full hover:border-fire/30 transition-colors"
              >
                {t.name}
              </Link>
            ))}
          </div>
        )}

        {/* Claim banner */}
        {!isClaimed && claimStatus !== "submitted" && (
          <div className="mt-4 p-3 bg-fire/5 border border-fire/10 rounded-lg flex items-center justify-between">
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
              className="ml-3 shrink-0 px-3 py-1.5 bg-fire text-white text-xs font-mono rounded-lg hover:bg-fire/90 transition-colors disabled:opacity-40"
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
      </div>

      {/* Book list */}
      {books.length === 0 ? (
        <p className="text-sm text-muted font-body">
          No books found yet. This page updates when someone grabs one of {handle}&apos;s videos on Hotlist.
        </p>
      ) : (
        <div className="space-y-3">
          <h2 className="text-xs font-mono text-muted uppercase tracking-wide">
            Books recommended by {handle}
          </h2>
          {books.map((book) => {
            const grRating = book.ratings.find((r) => r.source === "goodreads");
            const spice = book.spice.find(
              (s) =>
                s.source === "romance_io" ||
                s.source === "hotlist_community" ||
                s.source === "goodreads_inference"
            );

            return (
              <div key={book.id} className="flex gap-3 p-3 bg-white border border-border rounded-lg hover:border-fire/20 transition-colors">
                <Link href={`/book/${book.slug}`} className="shrink-0">
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
                          className="text-xs font-mono text-muted/70 px-1.5 py-0.5 border border-border rounded-full hover:border-fire/30 transition-colors"
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
