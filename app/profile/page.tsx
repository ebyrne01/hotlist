"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import Image from "next/image";
import ReadingDnaCard from "@/components/profile/ReadingDnaCard";
import SignInPrompt from "@/components/auth/SignInPrompt";
import { ArrowRight, BookOpen, Crown, Flame, ListChecks, LogOut, Star } from "lucide-react";

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
            .in("response", ["loved_it", "it_was_fine", "didnt_finish"]),
          supabase
            .from("reading_status")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user!.id)
            .in("response", ["must_read", "on_the_shelf"]),
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
      <div className="mx-auto max-w-5xl px-4 py-16 text-center">
        <div className="w-8 h-8 border-2 border-fire border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  if (!user) {
    return (
      <SignInPrompt
        eyebrow="Reader profile"
        title="Your taste profile is waiting."
        body="Sign in to see your Hotlists, Reading DNA, saved books, and ratings in one cozy little command center."
        context={{
          title: "Open your reader profile.",
          subtitle: "Sign in free to see your saved Hotlists, ratings, and Reading DNA.",
          note: "We will bring you right back to your profile.",
        }}
      />
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
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <header className="surface-parchment -mx-4 -mt-8 border-b border-aged-gold/30 px-4 py-9 sm:mx-0 sm:mt-0 sm:rounded-3xl sm:border sm:px-8 sm:py-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={displayName}
                width={72}
                height={72}
                unoptimized
                className="h-20 w-20 rounded-2xl border-2 border-aged-gold/30 object-cover shadow-sm"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-oxblood text-xl font-display font-bold text-cream shadow-sm ring-2 ring-aged-gold/30">
                {initials}
              </div>
            )}
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-aged-gold">
                Reader profile
              </p>
              <h1 className="mt-1 font-display text-4xl font-bold leading-tight text-ink sm:text-5xl">
                {displayName}
              </h1>
              <p className="mt-2 text-sm font-mono text-muted-a11y">
                Member since {memberSince}
              </p>
            </div>
          </div>
          <Link
            href="/reading/dna"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-aged-gold/40 bg-white/80 px-4 py-2 text-sm font-mono text-muted-a11y shadow-sm transition-colors hover:border-fire/30 hover:text-fire"
          >
            Tune recommendations
          </Link>
        </div>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Books Read" value={stats?.booksRead ?? 0} icon={<BookOpen className="h-4 w-4" />} />
        <StatCard label="Want to Read" value={stats?.wantToRead ?? 0} icon={<Flame className="h-4 w-4" />} />
        <StatCard label="Hotlists" value={stats?.hotlistsCreated ?? 0} icon={<ListChecks className="h-4 w-4" />} />
        <StatCard label="Ratings" value={stats?.ratingsGiven ?? 0} icon={<Star className="h-4 w-4" />} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
        <ReadingDnaCard />

        <section className="rounded-2xl border border-aged-gold/30 bg-white p-5 shadow-sm">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-aged-gold">
            Quick paths
          </p>
          <div className="mt-4 space-y-3">
            <ProfileLink href="/lists" label="My Hotlists" description="Compare saved books side by side." />
            <ProfileLink href="/reading" label="My Reading List" description="Manage saved, current, and finished reads." />
            <ProfileLink
              href="/profile/creator"
              label={profile?.isCreator ? "Creator Settings" : "Become a Creator"}
              description={profile?.isCreator ? "Update your public profile and affiliate links." : "Apply for creator tools and public shelves."}
              accent
            />
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-aged-gold/30 bg-white p-5 shadow-sm sm:flex sm:items-center sm:justify-between sm:gap-6">
        <div>
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-aged-gold" />
            <h2 className="font-display text-xl font-bold text-ink">
              Hotlist Pro
            </h2>
          </div>
          <p className="mt-2 text-sm font-body leading-6 text-muted-a11y">
            Advanced filters, reading analytics, and deeper taste tools. Coming soon.
          </p>
        </div>
        {onWaitlist ? (
          <p className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-fire/10 px-4 py-2 text-sm font-mono font-semibold text-fire sm:mt-0">
            You&apos;re on the list
          </p>
        ) : (
          <button
            onClick={handleJoinWaitlist}
            disabled={joining}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-fire px-4 py-2 text-sm font-mono text-cream transition-colors hover:bg-fire/90 disabled:opacity-50 sm:mt-0 sm:w-auto"
          >
            {joining ? "Joining..." : "Join the Waitlist"}
          </button>
        )}
      </section>

      <button
        onClick={signOut}
        className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-3 text-sm font-mono text-muted-a11y transition-colors hover:border-ink/20 hover:text-ink"
      >
        <LogOut className="h-4 w-4" />
        Sign Out
      </button>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-aged-gold/30 bg-white p-4 shadow-sm">
      <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-fire/10 text-fire">
        {icon}
      </div>
      <p className="font-display text-3xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-a11y">
        {label}
      </p>
    </div>
  );
}

function ProfileLink({
  href,
  label,
  description,
  accent = false,
}: {
  href: string;
  label: string;
  description: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex min-h-[76px] items-center justify-between gap-4 rounded-xl border px-4 py-3 transition-colors ${
        accent
          ? "border-fire/20 bg-fire/5 hover:border-fire/35"
          : "border-aged-gold/30 bg-cream/60 hover:border-fire/30"
      }`}
    >
      <span>
        <span className="block font-display text-base font-bold text-ink">
          {label}
        </span>
        <span className="mt-1 block text-xs font-body leading-5 text-muted-a11y">
          {description}
        </span>
      </span>
      <ArrowRight className={`h-4 w-4 shrink-0 transition-colors ${accent ? "text-fire" : "text-muted-a11y group-hover:text-fire"}`} />
    </Link>
  );
}
