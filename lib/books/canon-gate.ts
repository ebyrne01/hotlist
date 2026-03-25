/**
 * CANON GATE
 *
 * Determines whether a book meets the quality bar for public surfaces.
 * Called automatically when enrichment completes, and during weekly sweeps.
 *
 * A book must pass all requirements to be promoted to canon (is_canon = true).
 * The score (0-10) prioritizes which books get promoted first.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { isRomanceByGenres, isKnownRomanceAuthor } from "./romance-filter";
import { isCompilationTitle } from "./utils";

/**
 * Detect foreign-language editions and titles stuffed with marketing copy.
 * These slip through genre checks because the *genre* is romance, but the
 * book itself is a German translation or has Amazon blurb text in the title.
 */
function isForeignOrMarketingTitle(title: string): boolean {
  // Non-ASCII accented characters (common in French, German, Spanish, Portuguese, Turkish titles)
  if (/[àáâãäåèéêëìíîïòóôõöùúûüñçÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÑÇ]/.test(title)) {
    // Allow a few known English titles with accented characters (e.g., "Ménage", "Brontë")
    // by checking if the title is mostly ASCII
    const nonAsciiCount = (title.match(/[^\x00-\x7F]/g) || []).length;
    if (nonAsciiCount > 2) return true;
  }

  const lower = title.toLowerCase();
  const MARKETING_PATTERNS = [
    "perfect for readers of",
    "from the author of",
    "from the bestselling author",
    "from the multi-million",
    "for fans of",
    "for all readers of",
    "chapter sampler",
    "leseproben",
    "bestsellerautorin",
    "aus der welt",
    "clásicos de la literatura",
    "roman |",
    "roman -",
  ];
  if (MARKETING_PATTERNS.some((p) => lower.includes(p))) return true;

  // Titles over 100 chars are almost always marketing-stuffed editions
  if (title.length > 100) return true;

  return false;
}

/**
 * Detect study guides, summaries, coloring books, and other non-book products
 * that have Goodreads entries but should never be canon.
 */
function isNonBookTitle(title: string): boolean {
  const lower = title.toLowerCase();
  const NON_BOOK_PATTERNS = [
    "summary & analysis",
    "summary & study guide",
    "summary & wiki",
    "summary |",
    "summary of ",
    "study guide:",
    "study guide ",
    "conversation starters",
    "sparknotes",
    "cliffsnotes",
    "bookcaps",
    "colouring book",
    "coloring book",
    "activity book",
    "sticker book",
    "popup book",
    "pop-up book",
  ];
  return NON_BOOK_PATTERNS.some((p) => lower.includes(p));
}

export interface CanonGateResult {
  ready: boolean;
  score: number;
  blockers: string[];
}

/**
 * Evaluate whether a book is ready for canon promotion.
 * Queries the database for the book's current state + related data.
 */
export async function evaluateCanonReadiness(bookId: string): Promise<CanonGateResult> {
  const supabase = getAdminClient();

  // Fetch book + related data in parallel
  const [bookResult, tropesResult, flagsResult, ratingsResult, recsResult, spiceResult] =
    await Promise.all([
      supabase
        .from("books")
        .select(
          "id, title, author, enrichment_status, goodreads_id, cover_url, genres, ai_synopsis, amazon_asin, romance_io_slug, published_year, is_canon"
        )
        .eq("id", bookId)
        .single(),
      supabase
        .from("book_tropes")
        .select("trope_id")
        .eq("book_id", bookId),
      supabase
        .from("quality_flags")
        .select("id")
        .eq("book_id", bookId)
        .eq("status", "open")
        .eq("priority", "P0"),
      supabase
        .from("book_ratings")
        .select("rating, rating_count, source")
        .eq("book_id", bookId)
        .eq("source", "goodreads")
        .single(),
      supabase
        .from("book_recommendations")
        .select("id", { count: "exact", head: true })
        .eq("book_id", bookId),
      supabase
        .from("spice_signals")
        .select("source")
        .eq("book_id", bookId),
    ]);

  const book = bookResult.data;
  if (!book) return { ready: false, score: 0, blockers: ["book_not_found"] };

  const blockers: string[] = [];

  // --- REQUIREMENTS (all must pass) ---

  // 1. Enrichment must be complete
  if (book.enrichment_status !== "complete") {
    blockers.push("enrichment_incomplete");
  }

  // 2. Must be a romance book
  const genres: string[] = book.genres ?? [];
  const tropeCount = tropesResult.data?.length ?? 0;
  const hasRomanceGenre = isRomanceByGenres(genres);
  const hasRomanceAuthor = isKnownRomanceAuthor(book.author);
  const hasRomanceTropes = tropeCount > 0; // book_tropes only contains romance tropes

  if (!hasRomanceGenre && !hasRomanceAuthor && !hasRomanceTropes) {
    blockers.push("not_romance");
  }

  // 3. Must have a cover
  if (!book.cover_url) {
    blockers.push("no_cover");
  }

  // 3b. Must be English-language (foreign editions have accented titles or
  // German/French/Spanish marketing text baked into the title)
  if (isForeignOrMarketingTitle(book.title)) {
    blockers.push("foreign_or_marketing_title");
  }

  // 3c. Must not be a study guide, summary, coloring book, etc.
  if (isNonBookTitle(book.title)) {
    blockers.push("non_book_product");
  }

  // 3d. Must not be a box set, omnibus, or compilation
  if (isCompilationTitle(book.title)) {
    blockers.push("compilation_or_box_set");
  }

  // 4. Must have canonical identity (Goodreads ID)
  if (!book.goodreads_id) {
    blockers.push("no_goodreads_id");
  }

  // 5. No open P0 quality flags
  const openP0Count = flagsResult.data?.length ?? 0;
  if (openP0Count > 0) {
    blockers.push("open_p0_flags");
  }

  // 6. Published year: post-2000, or popular classic (GR rating count >= 1000)
  const grRatingCount = ratingsResult.data?.rating_count ?? 0;
  if (book.published_year && book.published_year < 2000 && grRatingCount < 1000) {
    blockers.push("old_low_demand");
  }

  // --- SCORE (0-10, for prioritization) ---
  let score = 0;

  const spiceSources = new Set(
    (spiceResult.data ?? []).map((s: { source: string }) => s.source)
  );

  if (book.romance_io_slug || spiceSources.has("romance_io")) score += 2;
  if (book.ai_synopsis) score += 2;
  if (book.amazon_asin) score += 1;
  if (tropeCount >= 2) score += 1;
  if (grRatingCount >= 500) score += 1;
  if (spiceSources.has("community")) score += 1;
  if ((recsResult.count ?? 0) > 0) score += 1;
  // Buzz score would require another query — skip for now, +1 available

  return {
    ready: blockers.length === 0,
    score,
    blockers,
  };
}

/**
 * Attempt to promote a book to canon if it meets all requirements.
 * Returns true if the book was promoted (or was already canon).
 */
export async function tryPromoteToCanon(bookId: string): Promise<boolean> {
  const result = await evaluateCanonReadiness(bookId);

  if (!result.ready) {
    return false;
  }

  const supabase = getAdminClient();

  // Only promote if not already canon (avoid unnecessary writes)
  const { data: book } = await supabase
    .from("books")
    .select("is_canon")
    .eq("id", bookId)
    .single();

  if (book?.is_canon) return true;

  const { error } = await supabase
    .from("books")
    .update({
      is_canon: true,
      canon_promoted_at: new Date().toISOString(),
      quality_score: result.score,
    })
    .eq("id", bookId);

  if (error) {
    console.warn(`[canon-gate] Failed to promote book ${bookId}:`, error.message);
    return false;
  }

  console.log(`[canon-gate] Promoted book ${bookId} to canon (score: ${result.score})`);
  return true;
}

/**
 * Demote a book from canon. Called when a P0 quality flag is created
 * or when an admin flags a book as wrong_book/junk_entry.
 */
export async function demoteFromCanon(
  bookId: string,
  reason: string
): Promise<void> {
  const supabase = getAdminClient();

  const { error } = await supabase
    .from("books")
    .update({ is_canon: false })
    .eq("id", bookId);

  if (error) {
    console.warn(`[canon-gate] Failed to demote book ${bookId}:`, error.message);
    return;
  }

  console.log(`[canon-gate] Demoted book ${bookId} from canon: ${reason}`);
}
