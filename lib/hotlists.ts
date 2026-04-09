/**
 * HOTLIST DATA FUNCTIONS
 *
 * All hotlist CRUD operations. These work with any Supabase client
 * (browser or server) and rely on RLS for authorization.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { hydrateBookDetailBatch } from "@/lib/books/cache";
import type { Hotlist, HotlistDetail, HotlistBookDetail, UserRating } from "@/lib/types";

// ── Helpers ──────────────────────────────────────────

function generateShareSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 30);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}

function mapHotlist(row: Record<string, unknown>, books: Hotlist["books"] = []): Hotlist {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    isPublic: row.is_public as boolean,
    shareSlug: (row.share_slug as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    books,
  };
}

// ── Read operations ──────────────────────────────────

/** Get all hotlists for a user, with book count. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getUserHotlists(supabase: any, userId: string): Promise<(Hotlist & { bookCount: number })[]> {
  const { data: hotlists } = await supabase
    .from("hotlists")
    .select("*, hotlist_books(count)")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (!hotlists) return [];

  return hotlists.map((row: Record<string, unknown>) => {
    const countData = row.hotlist_books as { count: number }[] | undefined;
    const bookCount = countData?.[0]?.count ?? 0;
    return { ...mapHotlist(row), bookCount };
  });
}

/** Lightweight hotlist info for OG metadata — no book hydration. */
export async function getHotlistMetadata(
  hotlistIdOrSlug: string
): Promise<{
  name: string;
  bookCount: number;
  sourceCreatorHandle: string | null;
  ownerName: string | null;
} | null> {
  const supabase = getAdminClient();

  const { data: bySlug } = await supabase
    .from("hotlists")
    .select("id, name, user_id, is_public, source_creator_handle")
    .eq("share_slug", hotlistIdOrSlug)
    .single();

  const hotlistRow = bySlug ?? (await supabase
    .from("hotlists")
    .select("id, name, user_id, is_public, source_creator_handle")
    .eq("id", hotlistIdOrSlug)
    .single()).data;

  if (!hotlistRow) return null;

  const [{ count }, { data: profile }] = await Promise.all([
    supabase
      .from("hotlist_books")
      .select("id", { count: "exact", head: true })
      .eq("hotlist_id", hotlistRow.id),
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", hotlistRow.user_id)
      .single(),
  ]);

  return {
    name: hotlistRow.name,
    bookCount: count ?? 0,
    sourceCreatorHandle: hotlistRow.source_creator_handle ?? null,
    ownerName: profile?.display_name ?? null,
  };
}

/** Get a hotlist with fully hydrated books. Server-side only (uses admin client). */
export async function getHotlistWithBooks(
  hotlistIdOrSlug: string,
  userId?: string
): Promise<HotlistDetail | { _accessDenied: true } | null> {
  const supabase = getAdminClient();

  // Try by share_slug first, then by id
  let hotlistRow: Record<string, unknown> | null = null;

  const { data: bySlug } = await supabase
    .from("hotlists")
    .select("*")
    .eq("share_slug", hotlistIdOrSlug)
    .single();

  if (bySlug) {
    hotlistRow = bySlug;
  } else {
    const { data: byId } = await supabase
      .from("hotlists")
      .select("*")
      .eq("id", hotlistIdOrSlug)
      .single();
    hotlistRow = byId;
  }

  if (!hotlistRow) return null;

  // Access control: private lists only visible to owner
  const isOwner = userId === (hotlistRow.user_id as string);
  if (!(hotlistRow.is_public as boolean) && !isOwner) {
    return { _accessDenied: true as const };
  }

  // Fetch hotlist books
  const { data: hotlistBooks } = await supabase
    .from("hotlist_books")
    .select("*, books(*)")
    .eq("hotlist_id", hotlistRow.id as string)
    .order("position", { ascending: true });

  // Fetch owner name + affiliate tag
  const { data: ownerProfile } = await supabase
    .from("profiles")
    .select("display_name, amazon_affiliate_tag, is_creator")
    .eq("id", hotlistRow.user_id as string)
    .single();

  // Batch-hydrate all books (4 queries total instead of 4 per book)
  const hotlistBookRows = (hotlistBooks ?? []) as Record<string, unknown>[];
  const rawBooks = hotlistBookRows
    .map((hb) => hb.books as Record<string, unknown>)
    .filter(Boolean);

  const [bookDetailMap, userRatingsRes] = await Promise.all([
    hydrateBookDetailBatch(supabase, rawBooks),
    userId && rawBooks.length > 0
      ? supabase
          .from("user_ratings")
          .select("book_id, star_rating, score, spice_rating, note")
          .eq("user_id", userId)
          .in("book_id", rawBooks.map((b) => b.id as string))
      : Promise.resolve({ data: null }),
  ]);

  // Index user ratings by book_id
  const userRatingMap = new Map<string, UserRating>();
  for (const r of (userRatingsRes.data ?? []) as Record<string, unknown>[]) {
    userRatingMap.set(r.book_id as string, {
      starRating: r.star_rating as number | null,
      score: r.score != null ? parseFloat(r.score as string) : null,
      spiceRating: r.spice_rating as number | null,
      note: (r.note as string) ?? null,
    });
  }

  const books: HotlistBookDetail[] = [];
  for (const hb of hotlistBookRows) {
    const rawBook = hb.books as Record<string, unknown>;
    if (!rawBook) continue;
    const bookId = rawBook.id as string;

    books.push({
      id: hb.id as string,
      bookId,
      position: hb.position as number,
      addedAt: hb.added_at as string,
      book: bookDetailMap.get(bookId)!,
      userRating: userRatingMap.get(bookId) ?? null,
    });
  }

  return {
    id: hotlistRow.id as string,
    userId: hotlistRow.user_id as string,
    name: hotlistRow.name as string,
    isPublic: hotlistRow.is_public as boolean,
    shareSlug: (hotlistRow.share_slug as string) ?? null,
    createdAt: hotlistRow.created_at as string,
    updatedAt: hotlistRow.updated_at as string,
    ownerName: ownerProfile?.display_name ?? null,
    ownerAffiliateTag: (ownerProfile?.is_creator && ownerProfile?.amazon_affiliate_tag) || null,
    sourceCreatorHandle: (hotlistRow.source_creator_handle as string) ?? null,
    sourceVideoUrl: (hotlistRow.source_video_url as string) ?? null,
    sourcePlatform: (hotlistRow.source_platform as string) ?? null,
    books,
  };
}

// ── Write operations (client-side, using RLS) ────────

/** Create a new hotlist. Returns the created hotlist. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createHotlist(supabase: any, userId: string, name: string): Promise<Hotlist | null> {
  const shareSlug = generateShareSlug(name);

  const { data, error } = await supabase
    .from("hotlists")
    .insert({
      user_id: userId,
      name: name.trim(),
      is_public: false,
      share_slug: shareSlug,
    })
    .select()
    .single();

  if (error || !data) {
    console.warn("[hotlists] Failed to create:", error?.message);
    return null;
  }

  return mapHotlist(data);
}

/** Add a book to a hotlist. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function addBookToHotlist(supabase: any, hotlistId: string, bookId: string): Promise<boolean> {
  // Get next position
  const { count } = await supabase
    .from("hotlist_books")
    .select("id", { count: "exact", head: true })
    .eq("hotlist_id", hotlistId);

  const { error } = await supabase
    .from("hotlist_books")
    .insert({
      hotlist_id: hotlistId,
      book_id: bookId,
      position: (count ?? 0) + 1,
    });

  if (error) {
    // Likely duplicate — book already in list
    if (error.code === "23505") return false;
    console.warn("[hotlists] Failed to add book:", error.message);
    return false;
  }

  // Update hotlist timestamp
  await supabase
    .from("hotlists")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", hotlistId);

  return true;
}

/** Remove a book from a hotlist. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function removeBookFromHotlist(supabase: any, hotlistId: string, bookId: string): Promise<void> {
  await supabase
    .from("hotlist_books")
    .delete()
    .eq("hotlist_id", hotlistId)
    .eq("book_id", bookId);

  await supabase
    .from("hotlists")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", hotlistId);
}

/** Toggle a hotlist's public/private status. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function toggleHotlistPublic(supabase: any, hotlistId: string): Promise<boolean> {
  // Fetch current state
  const { data: current } = await supabase
    .from("hotlists")
    .select("is_public, share_slug")
    .eq("id", hotlistId)
    .single();

  if (!current) return false;

  const newIsPublic = !current.is_public;

  // Generate a share_slug if making public and doesn't have one
  const updates: Record<string, unknown> = {
    is_public: newIsPublic,
    updated_at: new Date().toISOString(),
  };

  if (newIsPublic && !current.share_slug) {
    const { data: hotlist } = await supabase
      .from("hotlists")
      .select("name")
      .eq("id", hotlistId)
      .single();
    if (hotlist) {
      updates.share_slug = generateShareSlug(hotlist.name);
    }
  }

  await supabase
    .from("hotlists")
    .update(updates)
    .eq("id", hotlistId);

  return newIsPublic;
}

/** Update a hotlist's name. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function updateHotlistName(supabase: any, hotlistId: string, name: string): Promise<void> {
  await supabase
    .from("hotlists")
    .update({ name: name.trim(), updated_at: new Date().toISOString() })
    .eq("id", hotlistId);
}

/** Delete a hotlist (cascade deletes hotlist_books). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function deleteHotlist(supabase: any, hotlistId: string): Promise<void> {
  await supabase
    .from("hotlists")
    .delete()
    .eq("id", hotlistId);
}
