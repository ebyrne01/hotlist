/**
 * Fetch all data needed to render a share card image or page.
 * Used by both the image generation route and the public share page.
 */

import { getAdminClient } from "@/lib/supabase/admin";

export interface ShareCardData {
  card: {
    id: string;
    aspectRatio: string;
    spiceOverride: number | null;
    tropesSelected: string[];
    creatorQuote: string | null;
    sourceVideoUrl: string | null;
    viewCount: number;
    exportCount: number;
  };
  book: {
    id: string;
    title: string;
    author: string;
    coverUrl: string | null;
    slug: string;
    description: string | null;
  };
  ratings: {
    goodreads: number | null;
    goodreadsCount: number | null;
    amazon: number | null;
  };
  spiceLevel: number;
  heatLabel: string;
  tropes: string[];
  creator: {
    id: string;
    vanitySlug: string | null;
    displayName: string | null;
    amazonAffiliateTag: string | null;
  };
}

const HEAT_LABELS: Record<number, string> = {
  1: "Sweet",
  2: "Mild",
  3: "Steamy",
  4: "Spicy",
  5: "Scorching",
};

export async function fetchShareCardData(
  cardId: string
): Promise<ShareCardData | null> {
  const supabase = getAdminClient();

  // Fetch the card
  const { data: card } = await supabase
    .from("creator_share_cards")
    .select("*")
    .eq("id", cardId)
    .single();

  if (!card) return null;

  // Fetch book, ratings, spice, tropes, and creator profile in parallel
  const [bookRes, ratingsRes, spiceRes, tropesRes, profileRes] =
    await Promise.all([
      supabase
        .from("books")
        .select("id, title, author, cover_url, slug, description")
        .eq("id", card.book_id)
        .single(),
      supabase
        .from("book_ratings")
        .select("source, rating, rating_count")
        .eq("book_id", card.book_id),
      supabase
        .from("spice_signals")
        .select("source, spice_value, confidence")
        .eq("book_id", card.book_id)
        .order("confidence", { ascending: false }),
      supabase
        .from("book_tropes")
        .select("tropes(name)")
        .eq("book_id", card.book_id),
      supabase
        .from("profiles")
        .select("id, vanity_slug, display_name, amazon_affiliate_tag")
        .eq("id", card.creator_id)
        .single(),
    ]);

  if (!bookRes.data) return null;

  // Extract ratings
  const grRow = (ratingsRes.data ?? []).find(
    (r: Record<string, unknown>) => r.source === "goodreads"
  );
  const amzRow = (ratingsRes.data ?? []).find(
    (r: Record<string, unknown>) => r.source === "amazon"
  );

  // Determine spice level: card override > best signal
  let spiceLevel = card.spice_override ?? 0;
  if (!card.spice_override && spiceRes.data && spiceRes.data.length > 0) {
    spiceLevel = Math.round(Number(spiceRes.data[0].spice_value));
  }

  // Extract trope names from the card's selected subset, or fallback to all
  const allTropes = (tropesRes.data ?? []).map(
    (bt: Record<string, unknown>) =>
      ((bt.tropes as Record<string, unknown>)?.name as string) ?? ""
  );
  const selectedTropes =
    (card.tropes_selected as string[])?.length > 0
      ? (card.tropes_selected as string[]).filter((t: string) =>
          allTropes.includes(t)
        )
      : allTropes.slice(0, 4);

  return {
    card: {
      id: card.id,
      aspectRatio: card.aspect_ratio ?? "9:16",
      spiceOverride: card.spice_override,
      tropesSelected: card.tropes_selected ?? [],
      creatorQuote: card.creator_quote,
      sourceVideoUrl: card.source_video_url,
      viewCount: card.view_count ?? 0,
      exportCount: card.export_count ?? 0,
    },
    book: {
      id: bookRes.data.id,
      title: bookRes.data.title,
      author: bookRes.data.author,
      coverUrl: bookRes.data.cover_url,
      slug: bookRes.data.slug,
      description: bookRes.data.description,
    },
    ratings: {
      goodreads: grRow ? parseFloat(grRow.rating as string) : null,
      goodreadsCount: grRow?.rating_count
        ? Number(grRow.rating_count)
        : null,
      amazon: amzRow && (amzRow.rating_count as number | null) != null && (amzRow.rating_count as number) >= 50
        ? parseFloat(amzRow.rating as string)
        : null,
    },
    spiceLevel,
    heatLabel: HEAT_LABELS[spiceLevel] ?? "",
    tropes: selectedTropes,
    creator: {
      id: profileRes.data?.id ?? card.creator_id,
      vanitySlug: profileRes.data?.vanity_slug ?? null,
      displayName: profileRes.data?.display_name ?? null,
      amazonAffiliateTag: profileRes.data?.amazon_affiliate_tag ?? null,
    },
  };
}
