/**
 * Public creator profile page.
 * Route: myhotlist.app/{vanitySlug}
 *
 * Server component that fetches all profile data and passes it
 * to CreatorProfileClient for rendering.
 */

import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAdminClient } from "@/lib/supabase/admin";
import CreatorProfileClient from "./CreatorProfileClient";

interface PageProps {
  params: { vanitySlug: string };
}

/** Slugs reserved for existing app routes — never treat these as vanity profiles. */
const RESERVED_SLUGS = new Set([
  "search",
  "lists",
  "booktok",
  "reading",
  "profile",
  "book",
  "api",
  "auth",
  "about",
  "privacy",
  "terms",
  "pro",
  "discover",
  "tropes",
  "grab",
  "dashboard",
  "settings",
]);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { vanitySlug } = params;

  if (RESERVED_SLUGS.has(vanitySlug.toLowerCase())) {
    return { title: "Not Found — Hotlist" };
  }

  const supabase = getAdminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("vanity_slug", vanitySlug)
    .eq("is_creator", true)
    .single();

  if (!profile) {
    return { title: "Not Found — Hotlist" };
  }

  const displayName = profile.display_name || vanitySlug;

  return {
    title: `${displayName} — Hotlist`,
    description: `See ${displayName}'s public hotlists, reading stats, and BookTok recommendations on Hotlist.`,
  };
}

export default async function CreatorProfilePage({ params }: PageProps) {
  const { vanitySlug } = params;

  // ── Reserved word guard ──────────────────────────────────────────
  if (RESERVED_SLUGS.has(vanitySlug.toLowerCase())) {
    notFound();
  }

  const supabase = getAdminClient();

  // ── Lookup creator profile ───────────────────────────────────────
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("vanity_slug", vanitySlug)
    .eq("is_creator", true)
    .single();

  if (!profile) {
    notFound();
  }

  // ── Fetch data in parallel ───────────────────────────────────────
  const [hotlistsResult, readCountResult, avgSpiceResult, topTropesResult, mentionCountResult] =
    await Promise.all([
      // Public hotlists with first 4 book covers
      supabase
        .from("hotlists")
        .select(
          "id, name, share_slug, is_public, updated_at, source_video_url, source_video_thumbnail, hotlist_books(count)"
        )
        .eq("user_id", profile.id)
        .eq("is_public", true)
        .order("updated_at", { ascending: false }),

      // Books read count
      supabase
        .from("reading_status")
        .select("id", { count: "exact", head: true })
        .eq("user_id", profile.id)
        .eq("status", "read"),

      // Average spice rating
      supabase
        .from("user_ratings")
        .select("spice_rating")
        .eq("user_id", profile.id)
        .not("spice_rating", "is", null),

      // Top tropes from books they've read
      supabase.rpc("get_top_tropes_for_user", { p_user_id: profile.id, p_limit: 3 }).then(
        (res) => res,
        // Fallback if the RPC doesn't exist — query manually
        () => ({ data: null, error: null })
      ),

      // Creator mentions count
      supabase
        .from("creator_handles")
        .select("id, creator_book_mentions(count)")
        .eq("claimed_by", profile.id),
    ]);

  // ── Fetch book covers for each hotlist ───────────────────────────
  const hotlists = hotlistsResult.data || [];
  const hotlistIds = hotlists.map((h: Record<string, unknown>) => h.id as string);

  const hotlistBookCovers: Record<string, { cover_url: string | null; title: string }[]> = {};
  if (hotlistIds.length > 0) {
    const { data: coverRows } = await supabase
      .from("hotlist_books")
      .select("hotlist_id, position, books(cover_url, title)")
      .in("hotlist_id", hotlistIds)
      .order("position", { ascending: true })
      .limit(4 * hotlistIds.length); // rough upper bound

    if (coverRows) {
      for (const row of coverRows as Record<string, unknown>[]) {
        const hid = row.hotlist_id as string;
        if (!hotlistBookCovers[hid]) hotlistBookCovers[hid] = [];
        if (hotlistBookCovers[hid].length < 4) {
          const book = row.books as { cover_url: string | null; title: string } | null;
          if (book) {
            hotlistBookCovers[hid].push(book);
          }
        }
      }
    }
  }

  // ── Compute reading stats ────────────────────────────────────────
  const booksReadCount = readCountResult.count ?? 0;

  // Average spice from user's own ratings
  const spiceRatings = (avgSpiceResult.data || []) as { spice_rating: number }[];
  const avgSpice =
    spiceRatings.length > 0
      ? spiceRatings.reduce((sum, r) => sum + r.spice_rating, 0) / spiceRatings.length
      : null;

  // Top tropes — try RPC result first, then fall back to inline query
  let topTropes: { name: string; slug: string }[] = [];
  if (topTropesResult.data && Array.isArray(topTropesResult.data) && topTropesResult.data.length > 0) {
    topTropes = topTropesResult.data.map((t: Record<string, unknown>) => ({
      name: t.name as string,
      slug: t.slug as string,
    }));
  } else {
    // Manual fallback: reading_status → book_tropes → tropes
    const { data: tropeRows } = await supabase
      .from("reading_status")
      .select("book_id")
      .eq("user_id", profile.id)
      .eq("status", "read")
      .limit(200);

    if (tropeRows && tropeRows.length > 0) {
      const bookIds = tropeRows.map((r: Record<string, unknown>) => r.book_id as string);
      const { data: btRows } = await supabase
        .from("book_tropes")
        .select("tropes(name, slug)")
        .in("book_id", bookIds);

      if (btRows) {
        const counts = new Map<string, { name: string; slug: string; count: number }>();
        for (const row of btRows as Record<string, unknown>[]) {
          const trope = row.tropes as { name: string; slug: string } | null;
          if (!trope) continue;
          const existing = counts.get(trope.slug);
          counts.set(trope.slug, {
            name: trope.name,
            slug: trope.slug,
            count: (existing?.count || 0) + 1,
          });
        }
        topTropes = Array.from(counts.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 3)
          .map(({ name, slug }) => ({ name, slug }));
      }
    }
  }

  // Creator mention count
  const creatorHandles = mentionCountResult.data || [];
  let mentionCount = 0;
  for (const ch of creatorHandles as Record<string, unknown>[]) {
    const mentions = ch.creator_book_mentions as { count: number }[] | undefined;
    if (mentions && mentions.length > 0) {
      mentionCount += mentions[0].count;
    }
  }

  // ── Fire analytics event (fire-and-forget) ──────────────────────
  supabase
    .from("analytics_events")
    .insert({ event_type: "profile_view", profile_id: profile.id })
    .then(() => {});

  // ── Build hotlist data for client ────────────────────────────────
  const hotlistsForClient = hotlists.map((h: Record<string, unknown>) => {
    const hid = h.id as string;
    const bookCountArr = h.hotlist_books as { count: number }[] | undefined;
    const bookCount = bookCountArr && bookCountArr.length > 0 ? bookCountArr[0].count : 0;

    return {
      id: hid,
      name: h.name as string,
      shareSlug: h.share_slug as string,
      bookCount,
      updatedAt: h.updated_at as string,
      sourceVideoUrl: (h.source_video_url as string) || null,
      sourceVideoThumbnail: (h.source_video_thumbnail as string) || null,
      covers: (hotlistBookCovers[hid] || []).map((b) => ({
        coverUrl: b.cover_url,
        title: b.title,
      })),
    };
  });

  // ── Render ───────────────────────────────────────────────────────
  return (
    <CreatorProfileClient
      profile={{
        id: profile.id,
        displayName: profile.display_name || vanitySlug,
        avatarUrl: profile.avatar_url || null,
        bio: profile.bio || null,
        creatorVerifiedAt: profile.creator_verified_at || null,
        tiktokHandle: profile.tiktok_handle || null,
        instagramHandle: profile.instagram_handle || null,
        youtubeHandle: profile.youtube_handle || null,
        blogUrl: profile.blog_url || null,
      }}
      hotlists={hotlistsForClient}
      stats={{
        booksRead: booksReadCount,
        avgSpice,
        topTropes,
        mentionCount,
      }}
    />
  );
}
