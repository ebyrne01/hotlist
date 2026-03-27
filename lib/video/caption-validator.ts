/**
 * CAPTION VALIDATOR — Backup sanity check for BookTok book identification.
 *
 * After the two-phase agent (Haiku observe + Sonnet verify) returns results,
 * this module cross-references the TikTok video caption against the agent's
 * picks. It catches cases where the caption explicitly names a book that the
 * agent missed or contradicts.
 *
 * This is a BACKUP signal, not a primary one — captions can be misleading
 * ("if you loved X", hashtag spam, unrelated text). We only act when the
 * caption contains a clear book reference pattern like "Title by Author".
 */

import { searchBooksForAgent } from "./agent-search";
import { getBookDetail } from "@/lib/books";
import type { ResolvedBook, ResolvedBookMatched } from "./book-resolver";

interface CaptionBook {
  title: string;
  author: string | null;
}

/**
 * Extract book references from a TikTok caption.
 * Only returns results for high-confidence patterns — we'd rather miss a
 * caption reference than act on a false positive.
 */
export function extractBooksFromCaption(caption: string): CaptionBook[] {
  if (!caption || caption.length < 5) return [];

  // Strip hashtags and @mentions (but preserve "by @Author Name" first)
  // Normalize "by @AuthorName" → "by AuthorName"
  let cleaned = caption.replace(/by\s+@/gi, "by ");

  // Remove standalone hashtags and @mentions
  cleaned = cleaned.replace(/#\w+/g, "").replace(/@\w+/g, "").trim();

  // Skip captions that are just hashtags/emojis/very short after cleaning
  if (cleaned.length < 5) return [];

  // Skip comparison/recommendation captions — these name books the creator
  // is NOT reviewing, just referencing
  const COMPARISON_PATTERNS = [
    /if you (?:liked|loved|enjoyed)\s/i,
    /similar to\s/i,
    /reminds me of\s/i,
    /books like\s/i,
    /read (?:this )?instead of\s/i,
    /better than\s/i,
    /versus\s/i,
    /\bvs\.?\b/i,
  ];
  // Don't skip the whole caption — just note that comparisons are present
  const hasComparison = COMPARISON_PATTERNS.some((p) => p.test(cleaned));

  const books: CaptionBook[] = [];

  // Pattern 1: "Title by Author" — the most reliable pattern
  // Match: "Close to You by Nissa Renzo", "Bride by Ali Hazelwood"
  // Avoid: "5 stars by far" (author name check), "by the way" (stop phrases)
  const BY_STOP_PHRASES = ["by far", "by the", "by all", "by any", "by no", "by now"];
  const byPattern = /(?:^|[.!?|—–\-,]\s*)([A-Z][^.!?|—–\-]*?)\s+by\s+([A-Z][A-Za-z'.]+(?:\s+[A-Z][A-Za-z'.]+){0,3})/g;

  let match;
  while ((match = byPattern.exec(cleaned)) !== null) {
    const fullMatch = match[0].toLowerCase();
    if (BY_STOP_PHRASES.some((p) => fullMatch.includes(p))) continue;

    const title = match[1].trim();
    const author = match[2].trim();

    // Sanity: title should be 2+ chars, author should look like a name (2+ words or single recognizable word)
    if (title.length < 2) continue;
    if (author.length < 2) continue;

    // Skip if this looks like it's inside a comparison phrase
    if (hasComparison) {
      const beforeMatch = cleaned.substring(0, match.index).toLowerCase();
      if (
        beforeMatch.endsWith("loved ") ||
        beforeMatch.endsWith("liked ") ||
        beforeMatch.endsWith("like ") ||
        beforeMatch.endsWith("enjoyed ")
      ) {
        continue;
      }
    }

    books.push({ title, author });
  }

  // Pattern 2: "reading/reviewing/about [Title]" without author
  // Lower confidence — only use if no Pattern 1 matches found
  if (books.length === 0) {
    const readingPattern =
      /(?:reading|reviewing|about|finished|just read|dnf'?d)\s+[""]?([A-Z][A-Za-z\s':]+?)[""]?(?:\s+by|\s*[.!?|#]|\s*$)/i;
    const readingMatch = readingPattern.exec(cleaned);
    if (readingMatch) {
      const title = readingMatch[1].trim();
      if (title.length >= 3 && title.split(/\s+/).length <= 8) {
        books.push({ title, author: null });
      }
    }
  }

  return books;
}

/**
 * Cross-reference caption-extracted books against agent results.
 * Returns updated resolved books array if caption adds or corrects anything.
 *
 * Rules:
 * 1. If caption names a book already in agent results → no change (agent confirmed it)
 * 2. If caption names a book NOT in agent results → search and add it
 * 3. If agent returned exactly 1 book AND caption names a different book →
 *    replace the agent's pick (caption is more reliable for single-book videos
 *    where the agent may have matched a visible-but-not-featured book)
 */
export async function validateAgentResultsWithCaption(
  caption: string,
  agentResults: ResolvedBook[]
): Promise<{ results: ResolvedBook[]; captionOverrides: string[] }> {
  const captionBooks = extractBooksFromCaption(caption);
  const overrides: string[] = [];

  if (captionBooks.length === 0) {
    return { results: agentResults, captionOverrides: [] };
  }

  // Build a set of titles the agent already found (lowercased for comparison)
  const agentTitles = new Set(
    agentResults
      .filter((r): r is ResolvedBookMatched => r.matched)
      .map((r) => r.book.title.toLowerCase())
  );
  const agentRawTitles = new Set(
    agentResults
      .filter((r) => !r.matched)
      .map((r) => r.rawTitle.toLowerCase())
  );

  let updatedResults = [...agentResults];

  for (const captionBook of captionBooks) {
    const captionTitleLower = captionBook.title.toLowerCase();

    // Check if agent already found this book (fuzzy title check)
    const alreadyFound =
      Array.from(agentTitles).some((t) => titlesSimilar(t, captionTitleLower)) ||
      Array.from(agentRawTitles).some((t) => titlesSimilar(t, captionTitleLower));

    if (alreadyFound) {
      continue; // Agent already has it, no action needed
    }

    // Caption names a book the agent didn't find — search for it
    const query = captionBook.author
      ? `${captionBook.title} ${captionBook.author}`
      : captionBook.title;

    const searchResults = await searchBooksForAgent(query);
    if (searchResults.length === 0) continue;

    // Validate the top result actually matches the caption's title
    const topResult = searchResults[0];
    if (!titlesSimilar(topResult.title.toLowerCase(), captionTitleLower)) {
      continue; // Search returned something different, skip
    }

    // We found a book the caption names that the agent missed
    // Hydrate it to a full BookDetail
    const bookDetail = topResult.goodreads_id
      ? await getBookDetailByGrId(topResult.goodreads_id)
      : await getBookDetailBySearch(topResult.title, topResult.author);

    if (!bookDetail) continue;

    const captionResolvedBook: ResolvedBook = {
      matched: true,
      book: bookDetail,
      creatorSentiment: "mentioned",
      creatorQuote: "",
      confidence: "medium",
    };

    // Rule 3: If agent had exactly 1 result and caption names a different book,
    // the agent likely matched a book visible on screen but not the featured one.
    // Replace the agent's pick with the caption's book.
    if (
      agentResults.length === 1 &&
      agentResults[0].matched &&
      !titlesSimilar(agentResults[0].book.title.toLowerCase(), captionTitleLower)
    ) {
      overrides.push(
        `Caption override: replaced agent pick "${agentResults[0].book.title}" with caption pick "${captionBook.title}"`
      );
      // Keep the agent's original as a secondary, add caption pick as primary
      updatedResults = [captionResolvedBook, ...updatedResults];
    } else {
      // Rule 2: Agent found other books but missed this one — add it
      overrides.push(`Caption addition: added "${captionBook.title}" from caption`);
      updatedResults.push(captionResolvedBook);
    }
  }

  return { results: updatedResults, captionOverrides: overrides };
}

/**
 * Check if two titles are similar enough to be the same book.
 * Uses word overlap — must share 60%+ of distinctive words.
 */
function titlesSimilar(a: string, b: string): boolean {
  // Exact match
  if (a === b) return true;

  // One contains the other
  if (a.includes(b) || b.includes(a)) return true;

  const STOP_WORDS = new Set([
    "the", "a", "an", "of", "in", "on", "at", "to", "for", "and",
    "or", "but", "is", "was", "are", "were", "be", "been",
  ]);

  const wordsA = a.split(/\s+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  const wordsB = b.split(/\s+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  if (wordsA.length === 0 || wordsB.length === 0) return false;

  const setB = new Set(wordsB);
  const overlap = wordsA.filter((w) => setB.has(w)).length;

  // 60% of the shorter title's words must match
  const minLen = Math.min(wordsA.length, wordsB.length);
  return overlap / minLen >= 0.6;
}

/**
 * Get a BookDetail by Goodreads ID — tries local DB first.
 */
async function getBookDetailByGrId(goodreadsId: string) {
  try {
    const { getAdminClient } = await import("@/lib/supabase/admin");
    const supabase = getAdminClient();
    const { data } = await supabase
      .from("books")
      .select("id")
      .eq("goodreads_id", goodreadsId)
      .single();

    if (data?.id) {
      return getBookDetail(data.id);
    }
  } catch {
    // Fall through to search
  }
  return null;
}

/**
 * Get a BookDetail by title + author search.
 */
async function getBookDetailBySearch(title: string, author: string) {
  try {
    const { getAdminClient } = await import("@/lib/supabase/admin");
    const supabase = getAdminClient();
    const { data } = await supabase
      .from("books")
      .select("id")
      .ilike("title", `%${title}%`)
      .ilike("author", `%${author}%`)
      .limit(1)
      .single();

    if (data?.id) {
      return getBookDetail(data.id);
    }
  } catch {
    // Not found
  }
  return null;
}
