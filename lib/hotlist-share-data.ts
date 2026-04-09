import { getAdminClient } from "@/lib/supabase/admin";

export interface HotlistShareData {
  name: string;
  bookCount: number;
  covers: string[];
  spiceMin: number | null;
  spiceMax: number | null;
  sharedTropes: string[];
  ownerName: string | null;
  creatorHandle: string | null;
  shareSlug: string;
}

/**
 * Fetch all data needed to render a Hotlist share card image.
 * Returns null if the hotlist doesn't exist or isn't public.
 */
export async function getHotlistShareData(
  shareSlug: string
): Promise<HotlistShareData | null> {
  const supabase = getAdminClient();

  // Fetch hotlist by share_slug
  const { data: hotlist } = await supabase
    .from("hotlists")
    .select("id, name, share_slug, is_public, user_id, source_creator_handle")
    .eq("share_slug", shareSlug)
    .single();

  if (!hotlist) return null;

  // Get owner name
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", hotlist.user_id)
    .single();

  // Get books in the hotlist
  const { data: hotlistBooks } = await supabase
    .from("hotlist_books")
    .select("book_id")
    .eq("hotlist_id", hotlist.id)
    .order("position", { ascending: true })
    .limit(10);

  const bookIds = (hotlistBooks ?? []).map((hb) => hb.book_id as string);
  if (bookIds.length === 0) {
    return {
      name: hotlist.name as string,
      bookCount: 0,
      covers: [],
      spiceMin: null,
      spiceMax: null,
      sharedTropes: [],
      ownerName: (profile?.display_name as string) ?? null,
      creatorHandle: (hotlist.source_creator_handle as string) ?? null,
      shareSlug: hotlist.share_slug as string,
    };
  }

  // Fetch book covers
  const { data: books } = await supabase
    .from("books")
    .select("id, cover_url")
    .in("id", bookIds);

  const coverMap = new Map(
    (books ?? []).map((b) => [b.id as string, b.cover_url as string | null])
  );
  const covers = bookIds
    .map((id) => coverMap.get(id))
    .filter((c): c is string => !!c && !c.includes("no-cover") && !c.includes("nophoto"))
    .slice(0, 5);

  // Fetch composite spice for range
  const { data: spiceRows } = await supabase
    .from("spice_signals")
    .select("book_id, spice_value")
    .in("book_id", bookIds)
    .eq("source", "composite");

  const spiceValues = (spiceRows ?? [])
    .map((r) => r.spice_value as number)
    .filter((v) => v > 0);
  const spiceMin = spiceValues.length > 0 ? Math.min(...spiceValues) : null;
  const spiceMax = spiceValues.length > 0 ? Math.max(...spiceValues) : null;

  // Fetch shared tropes (tropes appearing in 2+ books)
  const { data: tropeRows } = await supabase
    .from("book_tropes")
    .select("trope_id, tropes(name)")
    .in("book_id", bookIds);

  const tropeCounts = new Map<string, { name: string; count: number }>();
  for (const row of tropeRows ?? []) {
    const trope = row.tropes as unknown as { name: string } | null;
    if (!trope?.name) continue;
    const id = row.trope_id as string;
    const existing = tropeCounts.get(id);
    if (existing) {
      existing.count++;
    } else {
      tropeCounts.set(id, { name: trope.name, count: 1 });
    }
  }
  const sharedTropes = Array.from(tropeCounts.values())
    .filter((t) => t.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((t) => t.name);

  return {
    name: hotlist.name as string,
    bookCount: bookIds.length,
    covers,
    spiceMin,
    spiceMax,
    sharedTropes,
    ownerName: (profile?.display_name as string) ?? null,
    creatorHandle: (hotlist.source_creator_handle as string) ?? null,
    shareSlug: hotlist.share_slug as string,
  };
}
