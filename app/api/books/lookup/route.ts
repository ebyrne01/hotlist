import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { hydrateBookDetail } from "@/lib/books/cache";
import { saveBookToCache } from "@/lib/books/cache";
import { corsJson, corsOptions } from "@/lib/api/cors";
import type { BookDetail } from "@/lib/types";

export { corsOptions as OPTIONS };

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const supabase = getAdminClient();

  // ── Legacy enrichment polling (used by book detail page) ──
  const pollId = params.get("id");
  if (
    pollId &&
    !params.get("goodreads_id") &&
    !params.get("asin") &&
    !params.get("isbn") &&
    !params.get("title")
  ) {
    const { data: book } = await supabase
      .from("books")
      .select("id, enrichment_status")
      .eq("id", pollId)
      .single();

    if (!book) {
      return NextResponse.json({ found: false });
    }

    const [ratingsRes, spiceRes] = await Promise.all([
      supabase.from("book_ratings").select("id").eq("book_id", pollId).limit(1),
      supabase.from("book_spice").select("id").eq("book_id", pollId).limit(1),
    ]);

    return NextResponse.json({
      found: true,
      enrichmentStatus: book.enrichment_status,
      hasRatings: (ratingsRes.data?.length ?? 0) > 0,
      hasSpice: (spiceRes.data?.length ?? 0) > 0,
    });
  }

  // ── Extension lookup ──
  const goodreadsId = params.get("goodreads_id");
  const isbn = params.get("isbn");
  const asin = params.get("asin");
  const title = params.get("title");
  const author = params.get("author");

  let bookRow: Record<string, unknown> | null = null;

  // Try each identifier in order of specificity
  if (goodreadsId) {
    const { data } = await supabase
      .from("books")
      .select("*")
      .eq("goodreads_id", goodreadsId)
      .single();
    bookRow = data;
  }

  if (!bookRow && isbn) {
    const { data } = await supabase
      .from("books")
      .select("*")
      .or(`isbn.eq.${isbn},isbn13.eq.${isbn}`)
      .limit(1)
      .single();
    bookRow = data;
  }

  if (!bookRow && asin) {
    const { data } = await supabase
      .from("books")
      .select("*")
      .eq("amazon_asin", asin)
      .single();
    bookRow = data;
  }

  // Title+author fuzzy search as fallback
  if (!bookRow && title) {
    const { data: searchResults } = await supabase
      .from("books")
      .select("*")
      .ilike("title", `%${title}%`)
      .limit(5);

    if (searchResults && searchResults.length > 0) {
      const lowerTitle = title.toLowerCase().trim();
      const lowerAuthor = (author || "").toLowerCase().trim();
      bookRow =
        searchResults.find(
          (r: Record<string, unknown>) =>
            (r.title as string).toLowerCase().trim() === lowerTitle
        ) ||
        (lowerAuthor
          ? searchResults.find((r: Record<string, unknown>) =>
              (r.author as string)
                .toLowerCase()
                .includes(lowerAuthor.split(" ").pop() || "")
            )
          : null) ||
        searchResults[0];
    }
  }

  // Auto-provision from Goodreads: if we have a goodreads_id + title but
  // no match, create a provisional entry so the book exists for next time
  if (!bookRow && goodreadsId && title) {
    const saved = await saveBookToCache({
      goodreadsId,
      title,
      author: author || "Unknown",
    });
    if (saved) {
      const { data } = await supabase
        .from("books")
        .select("*")
        .eq("id", saved.id)
        .single();
      bookRow = data;
    }
  }

  if (!bookRow) {
    return corsJson({
      found: false,
      searchUrl: title
        ? `https://www.myhotlist.app/search?q=${encodeURIComponent(title + (author ? " " + author : ""))}`
        : null,
    });
  }

  const detail = await hydrateBookDetail(supabase, bookRow);

  return corsJson({ found: true, book: formatForExtension(detail) });
}

/**
 * Format a BookDetail for the extension response.
 * Uses compositeSpice (the multi-signal system) as the primary spice source.
 */
function formatForExtension(detail: BookDetail) {
  const gr = detail.ratings.find((r) => r.source === "goodreads");
  const amz = detail.ratings.find((r) => r.source === "amazon");
  const cs = detail.compositeSpice;

  return {
    id: detail.id,
    title: detail.title,
    author: detail.author,
    slug: detail.slug,
    coverUrl: detail.coverUrl,
    goodreadsRating: gr?.rating ?? null,
    goodreadsRatingCount: gr?.ratingCount ?? null,
    amazonRating: amz?.rating ?? null,
    spiceLevel: cs ? Math.round(cs.score) : null,
    spiceScore: cs?.score ?? null,
    spiceSource: cs?.primarySource ?? null,
    spiceAttribution: cs?.attribution ?? null,
    heatLabel: detail.romanceIoHeatLabel ?? null,
    tropes: detail.tropes.slice(0, 5).map((t) => t.name),
    hotlistUrl: `https://www.myhotlist.app/book/${detail.slug}`,
  };
}
