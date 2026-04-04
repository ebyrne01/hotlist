export const dynamic = "force-dynamic";

import { Metadata } from "next";
import Link from "next/link";
import { getAdminClient } from "@/lib/supabase/admin";

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
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-display font-bold text-ink mb-2">
        BookTok Creators
      </h1>
      <p className="text-sm font-body text-muted mb-8">
        Every time a reader grabs books from a BookTok video, we catalog the
        creator and their recommendations. Browse creators to find your next
        favorite book source.
      </p>

      {/* Trending section */}
      {hasTrending && (
        <section className="mb-10">
          <h2 className="text-xs font-mono text-muted uppercase tracking-wide mb-4">
            Trending This Month
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {trending.map((creator: Record<string, unknown>) => (
              <Link
                key={creator.id as string}
                href={`/discover/${encodeURIComponent(creator.handle as string)}`}
                className="flex items-center gap-3 p-3 bg-white border border-border rounded-lg hover:border-fire/30 transition-colors"
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
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* All creators */}
      {hasCreators && (
        <section>
          <h2 className="text-xs font-mono text-muted uppercase tracking-wide mb-4">
            All Creators
          </h2>
          <div className="space-y-2">
            {allCreators.map((creator: Record<string, unknown>) => (
              <Link
                key={creator.id as string}
                href={`/discover/${encodeURIComponent(creator.handle as string)}`}
                className="flex items-center justify-between p-3 bg-white border border-border rounded-lg hover:border-fire/30 transition-colors"
              >
                <div className="flex items-center gap-3">
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
        <div className="text-center py-12">
          <p className="text-sm font-body text-muted">
            No creators yet. Grab a BookTok video to start discovering creators!
          </p>
          <Link
            href="/booktok"
            className="inline-block mt-4 text-sm font-mono text-fire hover:text-fire/80 transition-colors"
          >
            Try BookTok &rarr;
          </Link>
        </div>
      )}
    </div>
  );
}
