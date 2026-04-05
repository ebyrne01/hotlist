"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import ReadingDnaCard from "@/components/profile/ReadingDnaCard";

interface UserStats {
  booksRead: number;
  wantToRead: number;
  hotlistsCreated: number;
  ratingsGiven: number;
}

export default function ProfilePage() {
  const { user, profile, signOut, isLoading } = useAuth();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [onWaitlist, setOnWaitlist] = useState(false);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!user) return;

    const supabase = createClient();

    async function fetchStats() {
      const [readRes, wantRes, hotlistRes, ratingsRes, waitlistRes] =
        await Promise.all([
          supabase
            .from("reading_status")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user!.id)
            .eq("status", "read"),
          supabase
            .from("reading_status")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user!.id)
            .eq("status", "want_to_read"),
          supabase
            .from("hotlists")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user!.id),
          supabase
            .from("user_ratings")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user!.id),
          supabase
            .from("pro_waitlist")
            .select("id")
            .eq("user_id", user!.id)
            .maybeSingle(),
        ]);

      setStats({
        booksRead: readRes.count ?? 0,
        wantToRead: wantRes.count ?? 0,
        hotlistsCreated: hotlistRes.count ?? 0,
        ratingsGiven: ratingsRes.count ?? 0,
      });

      setOnWaitlist(!!waitlistRes.data);
    }

    fetchStats();
  }, [user]);

  async function handleJoinWaitlist() {
    if (!user) return;
    setJoining(true);
    const supabase = createClient();
    await supabase.from("pro_waitlist").upsert(
      { email: user.email!, user_id: user.id },
      { onConflict: "email" }
    );
    setOnWaitlist(true);
    setJoining(false);
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-8 h-8 border-2 border-fire border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-muted font-mono text-sm">
          Redirecting...
        </p>
      </div>
    );
  }

  const displayName =
    profile?.displayName ??
    user.user_metadata?.full_name ??
    user.email?.split("@")[0] ??
    "Reader";

  const avatarUrl =
    profile?.avatarUrl ?? user.user_metadata?.avatar_url ?? null;

  const memberSince = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : new Date(user.created_at).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });

  const initials = displayName
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      {/* Profile header */}
      <div className="flex items-center gap-4 mb-8">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={displayName}
            className="w-16 h-16 rounded-full object-cover border-2 border-border"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-fire text-cream flex items-center justify-center text-xl font-mono font-bold">
            {initials}
          </div>
        )}
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">
            {displayName}
          </h1>
          <p className="text-sm text-muted font-mono">
            Member since {memberSince}
          </p>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Books Read", value: stats?.booksRead ?? 0 },
          { label: "Want to Read", value: stats?.wantToRead ?? 0 },
          { label: "Hotlists", value: stats?.hotlistsCreated ?? 0 },
          { label: "Ratings", value: stats?.ratingsGiven ?? 0 },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white border border-border rounded-lg p-4 text-center"
          >
            <p className="font-display text-2xl font-bold text-ink">
              {stat.value}
            </p>
            <p className="text-xs font-mono text-muted uppercase tracking-wide mt-1">
              {stat.label}
            </p>
          </div>
        ))}
      </div>

      {/* Reading DNA */}
      <ReadingDnaCard />

      {/* Quick links */}
      <div className="space-y-3 mb-8">
        <Link
          href="/lists"
          className="flex items-center justify-between px-4 py-3 bg-white border border-border rounded-lg hover:border-fire/30 transition-colors group"
        >
          <span className="font-mono text-sm text-ink">My Hotlists</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="text-muted group-hover:text-fire transition-colors"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        </Link>
        <Link
          href="/dashboard?tab=reading"
          className="flex items-center justify-between px-4 py-3 bg-white border border-border rounded-lg hover:border-fire/30 transition-colors group"
        >
          <span className="font-mono text-sm text-ink">My Reading List</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="text-muted group-hover:text-fire transition-colors"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        </Link>
        <Link
          href="/profile/creator"
          className="flex items-center justify-between px-4 py-3 bg-white border border-fire/15 rounded-lg hover:border-fire/30 transition-colors group"
        >
          <span className="font-mono text-sm text-ink">
            {profile?.isCreator ? "Creator Settings" : "Become a Creator"}
          </span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="text-fire group-hover:text-fire transition-colors"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        </Link>
      </div>

      {/* Pro waitlist */}
      <div className="bg-white border border-border rounded-lg p-6 mb-8">
        <h2 className="font-display text-lg font-bold text-ink mb-1">
          Hotlist Pro
        </h2>
        <p className="text-sm text-muted mb-4">
          Advanced filters, reading analytics, and more. Coming soon.
        </p>
        {onWaitlist ? (
          <p className="text-sm font-mono text-fire font-semibold">
            You&apos;re on the list!
          </p>
        ) : (
          <button
            onClick={handleJoinWaitlist}
            disabled={joining}
            className="px-4 py-2 bg-fire text-cream text-sm font-mono rounded-lg hover:bg-fire/90 transition-colors disabled:opacity-50"
          >
            {joining ? "Joining..." : "Join the Waitlist"}
          </button>
        )}
      </div>

      {/* Sign out */}
      <button
        onClick={signOut}
        className="w-full px-4 py-3 border border-border rounded-lg text-sm font-mono text-muted hover:text-ink hover:border-ink/20 transition-colors"
      >
        Sign Out
      </button>
    </div>
  );
}
