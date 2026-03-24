/**
 * FEEDBACK PIPELINE
 *
 * Converts user feedback (grab_feedback, search_analytics) into actionable
 * quality flags. Run periodically to close the feedback loop.
 *
 * Rules:
 * - Single wrong_book/wrong_edition feedback → P1 quality flag
 * - 3+ reports on same book → escalate to P0
 * - missing_book feedback is informational (logged, not flagged)
 */

import { getAdminClient } from "@/lib/supabase/admin";

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
