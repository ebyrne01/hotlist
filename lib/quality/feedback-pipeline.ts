/**
 * FEEDBACK PIPELINE
 *
 * Converts user feedback (grab_feedback, search_analytics) into actionable
 * quality flags AND applies corrections to grab results.
 *
 * Two processing modes:
 * 1. Flag creation: wrong_book/wrong_edition with a book_id → quality flags
 * 2. Grab correction: wrong_book with correction notes → search for correct
 *    book, update video_grabs extracted_books, add to hotlist
 *
 * Rules:
 * - Single wrong_book/wrong_edition feedback → P1 quality flag
 * - 3+ reports on same book → escalate to P0
 * - missing_book feedback is informational (logged, not flagged)
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { searchBooksForAgent } from "@/lib/video/agent-search";
import { getBookDetail } from "@/lib/books";
import { saveProvisionalBook } from "@/lib/books/cache";
import { searchGoogleBooks } from "@/lib/books/google-books";
import { queueEnrichmentJobs } from "@/lib/enrichment/queue";

export interface FeedbackPipelineResult {
  processed: number;
  flagsCreated: number;
  escalatedToP0: number;
}

/**
 * Process unprocessed grab_feedback entries and create quality flags.
 */
export async function processGrabFeedback(): Promise<FeedbackPipelineResult> {
  const supabase = getAdminClient();
  const result: FeedbackPipelineResult = { processed: 0, flagsCreated: 0, escalatedToP0: 0 };

  // Fetch unprocessed feedback with a book_id (missing_book has null book_id)
  const { data: feedback, error } = await supabase
    .from("grab_feedback")
    .select("id, book_id, book_title, feedback_type, notes, created_at")
    .is("processed_at", null)
    .not("book_id", "is", null)
    .in("feedback_type", ["wrong_book", "wrong_edition"])
    .order("created_at", { ascending: true })
    .limit(100);

  if (error || !feedback || feedback.length === 0) {
    return result;
  }

  // Group feedback by book_id to detect repeated reports
  const byBook = new Map<string, typeof feedback>();
  for (const fb of feedback) {
    const bookId = fb.book_id as string;
    if (!byBook.has(bookId)) byBook.set(bookId, []);
    byBook.get(bookId)!.push(fb);
  }

  for (const [bookId, reports] of Array.from(byBook.entries())) {
    // Count total reports for this book (including previously processed ones)
    const { count: totalReports } = await supabase
      .from("grab_feedback")
      .select("*", { count: "exact", head: true })
      .eq("book_id", bookId)
      .in("feedback_type", ["wrong_book", "wrong_edition"]);

    const reportCount = totalReports ?? reports.length;
    const priority = reportCount >= 3 ? "P0" : "P1";
    const feedbackType = reports[0].feedback_type as string;

    // Check if a flag already exists for this book + issue
    const { data: existingFlag } = await supabase
      .from("quality_flags")
      .select("id, priority")
      .eq("book_id", bookId)
      .eq("issue_type", feedbackType)
      .eq("status", "open")
      .single();

    if (existingFlag) {
      // Escalate to P0 if threshold met and not already P0
      if (priority === "P0" && existingFlag.priority !== "P0") {
        await supabase
          .from("quality_flags")
          .update({ priority: "P0" })
          .eq("id", existingFlag.id);
        result.escalatedToP0++;
        console.log(`[feedback] Escalated flag for "${reports[0].book_title}" to P0 (${reportCount} reports)`);
      }
    } else {
      // Create new quality flag from user feedback
      const notes = reports
        .map((r) => r.notes)
        .filter(Boolean)
        .join("; ");

      await supabase.from("quality_flags").insert({
        book_id: bookId,
        field_name: feedbackType === "wrong_book" ? "general" : "goodreads_id",
        issue_type: feedbackType,
        source: "user_feedback",
        confidence: Math.min(0.5 + reportCount * 0.15, 1.0),
        original_value: notes || null,
        priority,
        auto_fixable: false,
        status: "open",
      });

      result.flagsCreated++;
      console.log(`[feedback] Created ${priority} flag for "${reports[0].book_title}" (${feedbackType}, ${reportCount} reports)`);

      // Auto-demote from canon if P0 wrong_book
      if (priority === "P0" && feedbackType === "wrong_book") {
        const { demoteFromCanon } = await import("@/lib/books/canon-gate");
        await demoteFromCanon(bookId, `user_feedback: ${reportCount} wrong_book reports`);
      }
    }

    // Mark all reports as processed
    const reportIds = reports.map((r) => r.id);
    await supabase
      .from("grab_feedback")
      .update({ processed_at: new Date().toISOString() })
      .in("id", reportIds);

    result.processed += reports.length;
  }

  return result;
}

// ── Grab Correction Pipeline ──────────────────────────────────────────────────

export interface GrabCorrectionResult {
  processed: number;
  corrected: number;
  hotlistsUpdated: number;
  failed: string[];
}

/**
 * Process grab feedback that has correction notes — search for the correct
 * book, update the video_grabs extracted_books, and add to associated hotlists.
 *
 * Handles both:
 * - Unmatched books (book_id is null, rawTitle in extracted_books)
 * - Wrongly matched books (book_id is set, wrong book in extracted_books)
 */
export async function processGrabCorrections(): Promise<GrabCorrectionResult> {
  const supabase = getAdminClient();
  const result: GrabCorrectionResult = { processed: 0, corrected: 0, hotlistsUpdated: 0, failed: [] };

  // Fetch unprocessed feedback with correction notes
  const { data: feedback, error } = await supabase
    .from("grab_feedback")
    .select("id, video_url, book_id, book_title, feedback_type, notes")
    .is("processed_at", null)
    .in("feedback_type", ["wrong_book", "wrong_edition", "missing_book"])
    .not("notes", "is", null)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error || !feedback || feedback.length === 0) {
    return result;
  }

  for (const fb of feedback) {
    result.processed++;
    const correction = parseCorrectionNotes(fb.notes as string);
    if (!correction) {
      // Notes don't contain a parseable correction — skip (will be handled as flag)
      await markFeedbackProcessed(supabase, fb.id as string);
      continue;
    }

    console.log(`[feedback] Processing correction: "${fb.book_title}" → "${correction.title}" by ${correction.author ?? "unknown"}`);

    try {
      // Search for the correct book — validate results match the correction title
      const searchQuery = correction.author
        ? `${correction.title} ${correction.author}`
        : correction.title;

      let correctBook: { id: string; title: string; author: string; goodreads_id: string | null } | null = null;

      // Helper: check if a result title is a reasonable match for the correction
      const correctionTitleNorm = correction.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
      const correctionWords = correctionTitleNorm.split(/\s+/).filter(w => w.length > 2);

      const isTitleMatch = (resultTitle: string): boolean => {
        const norm = resultTitle.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
        // Exact or substring match
        if (norm.includes(correctionTitleNorm) || correctionTitleNorm.includes(norm)) return true;
        // Word overlap: at least 50% of correction words appear in result
        const matchCount = correctionWords.filter(w => norm.includes(w)).length;
        return correctionWords.length > 0 && matchCount / correctionWords.length >= 0.5;
      };

      // Step 1: Search agent (local DB, Google Books, Goodreads)
      const searchResults = await searchBooksForAgent(searchQuery);
      const validResult = searchResults.find(r => isTitleMatch(r.title));

      if (validResult) {
        if (validResult.goodreads_id) {
          const detail = await getBookDetail(validResult.goodreads_id);
          if (detail) {
            correctBook = { id: detail.id, title: detail.title, author: detail.author, goodreads_id: detail.goodreadsId ?? null };
          }
        }
        if (!correctBook) {
          // Check local DB by title
          const { data: existing } = await supabase
            .from("books")
            .select("id, title, author, goodreads_id")
            .ilike("title", `%${correction.title}%`)
            .limit(3);

          const dbMatch = (existing ?? []).find((e: Record<string, unknown>) => isTitleMatch(e.title as string));
          if (dbMatch) {
            correctBook = {
              id: dbMatch.id as string,
              title: dbMatch.title as string,
              author: dbMatch.author as string,
              goodreads_id: dbMatch.goodreads_id as string | null,
            };
          }
        }
      }

      // Step 2: If not found, try Google Books directly with title validation
      if (!correctBook) {
        const googleResults = await searchGoogleBooks(searchQuery);
        const validGoogle = googleResults.find(r => isTitleMatch(r.title));

        if (validGoogle) {
          // Check if this book already exists in DB
          const { data: existing } = await supabase
            .from("books")
            .select("id, title, author, goodreads_id")
            .ilike("title", `%${validGoogle.title}%`)
            .limit(3);

          const dbMatch = (existing ?? []).find((e: Record<string, unknown>) => isTitleMatch(e.title as string));
          if (dbMatch) {
            correctBook = {
              id: dbMatch.id as string,
              title: dbMatch.title as string,
              author: dbMatch.author as string,
              goodreads_id: dbMatch.goodreads_id as string | null,
            };
          } else {
            // Create a provisional book
            const provisional = await saveProvisionalBook({
              title: validGoogle.title,
              author: validGoogle.author,
              isbn: validGoogle.isbn ?? undefined,
              isbn13: validGoogle.isbn13 ?? undefined,
              googleBooksId: validGoogle.googleBooksId ?? undefined,
              coverUrl: validGoogle.coverUrl ?? undefined,
              description: validGoogle.description ?? undefined,
              pageCount: validGoogle.pageCount ?? undefined,
              publisher: validGoogle.publisher ?? undefined,
              publishedYear: validGoogle.publishedYear ?? undefined,
            });
            if (provisional) {
              correctBook = {
                id: provisional.id,
                title: provisional.title,
                author: provisional.author,
                goodreads_id: provisional.goodreadsId ?? null,
              };
              await queueEnrichmentJobs(provisional.id, provisional.title, provisional.author);
              console.log(`[feedback] Created provisional book: "${provisional.title}" (${provisional.id})`);
            }
          }
        }
      }

      if (!correctBook) {
        result.failed.push(`Could not find: "${correction.title}" by ${correction.author ?? "?"}`);
        await markFeedbackProcessed(supabase, fb.id as string);
        continue;
      }

      // Update the video_grabs extracted_books JSONB
      const videoUrl = fb.video_url as string;
      const grabUpdated = await updateGrabExtractedBooks(
        supabase,
        videoUrl,
        fb.book_title as string,
        fb.book_id as string | null,
        correctBook.id
      );

      if (grabUpdated) {
        result.corrected++;
        console.log(`[feedback] Corrected grab: "${fb.book_title}" → "${correctBook.title}" (${correctBook.id})`);

        // Add the correct book to any hotlist linked to this video
        const hotlistUpdated = await addBookToGrabHotlist(supabase, videoUrl, correctBook.id);
        if (hotlistUpdated) result.hotlistsUpdated++;
      }

      await markFeedbackProcessed(supabase, fb.id as string);
    } catch (err) {
      console.error(`[feedback] Error processing correction for "${fb.book_title}":`, err);
      result.failed.push(`Error: "${fb.book_title}" — ${err instanceof Error ? err.message : "unknown"}`);
      await markFeedbackProcessed(supabase, fb.id as string);
    }
  }

  return result;
}

/**
 * Parse user correction notes to extract title and author.
 *
 * Handles formats like:
 *   "I, Medusa by Ayana Gray"
 *   "Blood So Deadly Divine by J.M. Grosvalet"
 *   "Should be Fourth Wing by Rebecca Yarros"
 *   "The correct book is Iron Flame"
 */
function parseCorrectionNotes(notes: string): { title: string; author: string | null } | null {
  if (!notes || notes.trim().length < 2) return null;

  let cleaned = notes.trim();

  // Strip common prefixes
  cleaned = cleaned
    .replace(/^(should\s+be|it'?s|the\s+correct\s+(book|title)\s+is|meant\s+to\s+be|actually)\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();

  if (cleaned.length < 2) return null;

  // Try "Title by Author" pattern
  const byMatch = cleaned.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    return {
      title: byMatch[1].replace(/^["']|["']$/g, "").trim(),
      author: byMatch[2].replace(/^["']|["']$/g, "").trim(),
    };
  }

  // Try "Title - Author" pattern
  const dashMatch = cleaned.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch && dashMatch[1].length > 2 && dashMatch[2].length > 2) {
    return {
      title: dashMatch[1].replace(/^["']|["']$/g, "").trim(),
      author: dashMatch[2].replace(/^["']|["']$/g, "").trim(),
    };
  }

  // Just a title, no author
  return { title: cleaned, author: null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function markFeedbackProcessed(supabase: any, feedbackId: string) {
  await supabase
    .from("grab_feedback")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", feedbackId);
}

/**
 * Update the extracted_books JSONB in video_grabs to replace the wrong/unmatched
 * entry with the correct book data.
 */
async function updateGrabExtractedBooks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  videoUrl: string,
  wrongTitle: string,
  wrongBookId: string | null,
  correctBookId: string,
): Promise<boolean> {
  // Fetch the video grab
  const { data: grab } = await supabase
    .from("video_grabs")
    .select("id, extracted_books")
    .eq("url", videoUrl)
    .single();

  if (!grab || !grab.extracted_books) return false;

  // Fetch the correct book's full details for the JSONB
  const { data: correctBook } = await supabase
    .from("books")
    .select("id, title, author, goodreads_id, cover_url, series_name, series_position, enrichment_status")
    .eq("id", correctBookId)
    .single();

  if (!correctBook) return false;

  // Find and replace the wrong entry in extracted_books
  const books = grab.extracted_books as Record<string, unknown>[];
  const wrongTitleLower = wrongTitle.toLowerCase();
  let updated = false;

  for (let i = 0; i < books.length; i++) {
    const entry = books[i];
    const isMatch =
      // Match unmatched entry by rawTitle
      (!entry.matched && (entry.rawTitle as string)?.toLowerCase() === wrongTitleLower) ||
      // Match matched entry by book.id
      (entry.matched && wrongBookId && (entry.book as Record<string, unknown>)?.id === wrongBookId);

    if (isMatch) {
      // Preserve sentiment and quote from original entry
      books[i] = {
        matched: true,
        confidence: "high",
        correctedByFeedback: true,
        creatorQuote: entry.creatorQuote ?? null,
        creatorSentiment: entry.creatorSentiment ?? "neutral",
        book: {
          id: correctBook.id,
          title: correctBook.title,
          author: correctBook.author,
          goodreadsId: correctBook.goodreads_id,
          coverUrl: correctBook.cover_url,
          seriesName: correctBook.series_name,
          seriesPosition: correctBook.series_position,
          enrichmentStatus: correctBook.enrichment_status,
        },
      };
      updated = true;
      break;
    }
  }

  if (!updated) return false;

  // Write back updated extracted_books
  const { error } = await supabase
    .from("video_grabs")
    .update({ extracted_books: books })
    .eq("id", grab.id);

  return !error;
}

/**
 * Add a book to the hotlist linked to a video grab (if one exists).
 */
async function addBookToGrabHotlist(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  videoUrl: string,
  bookId: string,
): Promise<boolean> {
  // Find hotlist linked to this video
  const { data: hotlist } = await supabase
    .from("hotlists")
    .select("id")
    .eq("source_video_url", videoUrl)
    .limit(1)
    .single();

  if (!hotlist) return false;

  // Check if book is already in the hotlist
  const { data: existing } = await supabase
    .from("hotlist_books")
    .select("id")
    .eq("hotlist_id", hotlist.id)
    .eq("book_id", bookId)
    .limit(1);

  if (existing && existing.length > 0) return false;

  // Get the next position
  const { count } = await supabase
    .from("hotlist_books")
    .select("*", { count: "exact", head: true })
    .eq("hotlist_id", hotlist.id);

  const position = (count ?? 0) + 1;

  // Add to hotlist
  const { error } = await supabase
    .from("hotlist_books")
    .insert({
      hotlist_id: hotlist.id,
      book_id: bookId,
      position,
    });

  if (!error) {
    console.log(`[feedback] Added corrected book ${bookId} to hotlist ${hotlist.id} at position ${position}`);
  }

  return !error;
}
