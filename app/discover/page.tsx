export const dynamic = "force-dynamic";

import { Metadata } from "next";
import Link from "next/link";
import { getAdminClient } from "@/lib/supabase/admin";
import { ArrowRight, Sparkles, Users } from "lucide-react";

export const metadata: Metadata = {
  title: "BookTok Creators — Hotlist",
  description: "Find BookTok creators and see their book recommendations with ratings, spice levels, and tropes.",
};

export default async function DiscoverPage() {
  const supabase = getAdminClient();

  // Trending: most grabs in last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: trending } = await supabase
    .from("creator_handles")
    .select("*")
    .gte("last_grabbed_at", thirtyDaysAgo)
    .gt("book_count", 0)
    .order("grab_count", { ascending: false })
    .limit(10);

  // All creators with at least 1 grab, ordered by book count
  const { data: allCreators } = await supabase
    .from("creator_handles")
    .select("*")
    .gte("grab_count", 1)
    .order("book_count", { ascending: false })
    .limit(50);

  // Aggregate follower counts from user_follows for all displayed creators
  const allIds = [
    ...(trending || []).map((c: Record<string, unknown>) => c.id as string),
    ...(allCreators || []).map((c: Record<string, unknown>) => c.id as string),
  ];
  const uniqueIds = Array.from(new Set(allIds));
  if (uniqueIds.length > 0) {
    const { data: followCounts } = await supabase.rpc("count_followers_batch", {
      handle_ids: uniqueIds,
    });
    // Fallback: if RPC doesn't exist, use individual counts (already 0 from column)
    if (followCounts) {
      const countMap = new Map(
        (followCounts as { creator_handle_id: string; count: number }[]).map(
          (r) => [r.creator_handle_id, r.count]
        )
      );
      for (const c of [...(trending || []), ...(allCreators || [])]) {
        const row = c as Record<string, unknown>;
        row.follower_count = countMap.get(row.id as string) ?? 0;
      }
    }
  }

  const hasTrending = trending && trending.length > 0;
  const hasCreators = allCreators && allCreators.length > 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12">
      <header className="surface-parchment -mx-4 -mt-8 border-b border-aged-gold/30 px-4 py-10 sm:mx-0 sm:mt-0 sm:rounded-3xl sm:border sm:px-8 sm:py-12">
        <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-fire">
              Creator discovery
            </p>
            <h1 className="mt-2 font-display text-4xl font-bold leading-tight text-ink sm:text-5xl">
              Find the BookTok taste-makers behind your TBR.
            </h1>
            <p className="mt-4 max-w-2xl text-base font-body leading-7 text-muted-a11y">
              Every time a reader grabs books from a video, Hotlist catalogs the
              creator and their recommendations. Follow creators whose picks
              match your mood.
            </p>
          </div>
          <Link
            href="/booktok"
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-fire px-5 py-3 text-sm font-mono text-white transition-colors hover:bg-fire/90"
          >
            Grab a video
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </header>

      {/* Trending section */}
      {hasTrending && (
        <section className="mt-8 mb-10">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fire">
                Trending this month
              </p>
              <h2 className="font-display text-2xl font-bold text-ink">
                Creators readers keep grabbing
              </h2>
            </div>
            <Sparkles className="hidden text-fire sm:block" size={20} aria-hidden="true" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {trending.map((creator: Record<string, unknown>) => (
              <Link
                key={creator.id as string}
                href={`/discover/${encodeURIComponent(creator.handle as string)}`}
                className="flex min-h-[88px] items-center gap-3 rounded-2xl border border-aged-gold/30 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-fire/30"
              >
                <div className="w-10 h-10 rounded-full bg-fire/10 flex items-center justify-center text-fire font-mono text-sm font-bold shrink-0">
                  {((creator.handle as string).replace("@", "").charAt(0)).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-ink font-semibold truncate">
                    {creator.handle as string}
                  </p>
                  <p className="text-xs font-mono text-muted/70">
                    {creator.book_count as number} book{(creator.book_count as number) !== 1 ? "s" : ""} · {creator.platform as string}
                  </p>
                </div>
                <ArrowRight className="text-fire/60" size={16} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* All creators */}
      {hasCreators && (
        <section>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-a11y">
            All creators
          </p>
          <div className="mt-4 space-y-2">
            {allCreators.map((creator: Record<string, unknown>) => (
              <Link
                key={creator.id as string}
                href={`/discover/${encodeURIComponent(creator.handle as string)}`}
                className="flex min-h-[64px] flex-col gap-2 rounded-xl border border-border bg-white p-3 transition-colors hover:border-fire/30 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-fire/10 text-fire">
                    <Users size={16} aria-hidden="true" />
                  </span>
                  <span className="text-sm font-mono text-ink font-semibold">
                    {creator.handle as string}
                  </span>
                  <span className="text-xs font-mono text-muted/70">
                    {creator.platform as string}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono text-muted/70">
                  <span>{creator.book_count as number} books</span>
                  <span>{creator.grab_count as number} grabs</span>
                  {(creator.follower_count as number) > 0 && (
                    <span>{creator.follower_count as number} followers</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!hasCreators && (
        <div className="mt-8 rounded-2xl border border-aged-gold/30 bg-white p-8 text-center shadow-sm">
          <p className="font-display text-2xl font-bold text-ink">
            No creators yet.
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm font-body text-muted-a11y">
            No creators yet. Grab a BookTok video to start discovering creators!
          </p>
          <Link
            href="/booktok"
            className="mt-5 inline-flex min-h-[48px] items-center justify-center rounded-lg bg-fire px-5 py-3 text-sm font-mono text-white transition-colors hover:bg-fire/90"
          >
            Try BookTok &rarr;
          </Link>
        </div>
      )}
    </div>
  );
}
