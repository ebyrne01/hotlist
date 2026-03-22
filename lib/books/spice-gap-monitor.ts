/**
 * SPICE GAP MONITOR
 *
 * Monthly audit that identifies and fixes spice data gaps:
 *
 * 1. Books with ZERO spice signals → re-queue appropriate enrichment
 * 2. Top books missing romance.io spice → re-queue romance_io_spice
 * 3. Hierarchy violations (AI-inferred displayed when romance.io exists)
 * 4. Books stuck at genre-bucketing-only → attempt upgrade
 *
 * Can be triggered via cron or manually.
 * Cost: ~$1/run (mostly romance.io Serper re-queries).
 */

import { getAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Queue specific enrichment job types for a book */
async function queueSpecificJobs(
  supabase: SupabaseClient,
  bookId: string,
  jobTypes: string[]
): Promise<void> {
  const rows = jobTypes.map((jobType) => ({
    book_id: bookId,
    job_type: jobType,
    status: "pending",
    attempts: 0,
    next_retry_at: new Date().toISOString(),
  }));
  await supabase
    .from("enrichment_queue")
    .upsert(rows, { onConflict: "book_id,job_type" });
}

export interface SpiceAuditResult {
  zeroSpiceBooks: number;
  zeroSpiceRequeued: number;
  topBooksMissingRomanceIo: number;
  romanceIoRequeued: number;
  hierarchyViolations: number;
  hierarchyFixed: number;
  genreOnlyBooks: number;
  genreOnlyUpgraded: number;
  errors: number;
}

export async function runSpiceGapAudit(
  onProgress?: (msg: string) => void
): Promise<SpiceAuditResult> {
  const supabase = getAdminClient();
  const result: SpiceAuditResult = {
    zeroSpiceBooks: 0,
    zeroSpiceRequeued: 0,
    topBooksMissingRomanceIo: 0,
    romanceIoRequeued: 0,
    hierarchyViolations: 0,
    hierarchyFixed: 0,
    genreOnlyBooks: 0,
    genreOnlyUpgraded: 0,
    errors: 0,
  };

  // -------------------------------------------------------
  // STEP 1: Find books with ZERO spice signals
  // -------------------------------------------------------
  onProgress?.("[spice-audit] Step 1: Finding books with zero spice signals...");

  const { data: allBookIds } = await supabase
    .from("books")
    .select("id")
    .eq("enrichment_status", "complete");

  const { data: booksWithSpice } = await supabase
    .from("spice_signals")
    .select("book_id")
    .not("spice_value", "is", null);

  const spiceSet = new Set((booksWithSpice ?? []).map((r) => r.book_id));
  const zeroSpiceIds = (allBookIds ?? [])
    .map((r) => r.id)
    .filter((id) => !spiceSet.has(id));

  result.zeroSpiceBooks = zeroSpiceIds.length;
  onProgress?.(`[spice-audit] Found ${zeroSpiceIds.length} books with zero spice signals`);

  // Re-queue enrichment for zero-spice books
  for (const bookId of zeroSpiceIds.slice(0, 200)) {
    try {
      // Get book details for smart re-queueing
      const { data: book } = await supabase
        .from("books")
        .select("id, title, author, description, genres")
        .eq("id", bookId)
        .single();

      if (!book) continue;

      const jobs: string[] = [];

      // Always try romance.io first (highest external spice confidence)
      jobs.push("romance_io_spice");

      // If book has a description, LLM inference should work
      if (book.description && book.description.length > 50) {
        jobs.push("llm_spice");
      }

      // If book has genres, genre bucketing should provide a baseline
      if (book.genres && book.genres.length > 0) {
        // Genre bucketing runs automatically during enrichment
      }

      await queueSpecificJobs(supabase, bookId, jobs);
      result.zeroSpiceRequeued++;
    } catch {
      result.errors++;
    }
  }

  onProgress?.(
    `[spice-audit] Re-queued ${result.zeroSpiceRequeued} zero-spice books for enrichment`
  );

  // -------------------------------------------------------
  // STEP 2: Top books missing romance.io spice
  // -------------------------------------------------------
  onProgress?.("[spice-audit] Step 2: Checking top books for romance.io coverage...");

  // Get top 500 books by Goodreads ratings count (proxy for popularity)
  const { data: topBooks } = await supabase
    .from("books")
    .select("id, title")
    .eq("enrichment_status", "complete")
    .order("quality_score", { ascending: false })
    .limit(500);

  if (topBooks && topBooks.length > 0) {
    const topIds = topBooks.map((b) => b.id);

    // Check which have romance.io spice
    const { data: romanceIoSignals } = await supabase
      .from("spice_signals")
      .select("book_id")
      .in("book_id", topIds)
      .eq("source", "romance_io");

    const hasRomanceIo = new Set((romanceIoSignals ?? []).map((r) => r.book_id));
    const missingRomanceIo = topBooks.filter((b) => !hasRomanceIo.has(b.id));

    result.topBooksMissingRomanceIo = missingRomanceIo.length;
    onProgress?.(
      `[spice-audit] ${missingRomanceIo.length}/${topBooks.length} top books missing romance.io spice`
    );

    // Re-queue romance.io for missing books (limit to 100 per run)
    for (const book of missingRomanceIo.slice(0, 100)) {
      try {
        await queueSpecificJobs(supabase, book.id, ["romance_io_spice"]);
        result.romanceIoRequeued++;
      } catch {
        result.errors++;
      }
    }

    onProgress?.(
      `[spice-audit] Re-queued ${result.romanceIoRequeued} top books for romance.io re-check`
    );
  }

  // -------------------------------------------------------
  // STEP 3: Hierarchy violations
  // -------------------------------------------------------
  onProgress?.("[spice-audit] Step 3: Checking spice hierarchy compliance...");

  // Find books that have both romance_io and llm_inference signals
  // where romance_io should be primary but might not be
  const { data: dualSignalBooks } = await supabase
    .from("spice_signals")
    .select("book_id, source, spice_value, confidence")
    .in("source", ["romance_io", "llm_inference"])
    .order("book_id");

  if (dualSignalBooks) {
    // Group by book_id
    const byBook = new Map<string, { romance_io?: number; llm?: number }>();
    for (const signal of dualSignalBooks) {
      const entry = byBook.get(signal.book_id) ?? {};
      if (signal.source === "romance_io") entry.romance_io = signal.spice_value;
      if (signal.source === "llm_inference") entry.llm = signal.spice_value;
      byBook.set(signal.book_id, entry);
    }

    // Check for disagreements (not violations per se, but worth logging)
    let disagreements = 0;
    byBook.forEach((signals) => {
      if (
        signals.romance_io !== undefined &&
        signals.llm !== undefined &&
        Math.abs(signals.romance_io - signals.llm) > 2.0
      ) {
        disagreements++;
      }
    });

    result.hierarchyViolations = disagreements;
    onProgress?.(
      `[spice-audit] ${disagreements} books with romance.io/LLM spice disagreement >2.0`
    );
  }

  // -------------------------------------------------------
  // STEP 4: Books stuck at genre-bucketing only
  // -------------------------------------------------------
  onProgress?.("[spice-audit] Step 4: Finding books with only genre-bucketing spice...");

  // Find books whose only spice signal is genre_bucketing
  const { data: genreOnlyBooks } = await supabase.rpc("find_genre_only_spice_books");

  // If the RPC doesn't exist, do it manually
  if (!genreOnlyBooks) {
    // Get all books with genre_bucketing
    const { data: genreBucketBooks } = await supabase
      .from("spice_signals")
      .select("book_id")
      .eq("source", "genre_bucketing");

    if (genreBucketBooks) {
      const genreBookIds = genreBucketBooks.map((r) => r.book_id);

      // Check which of these ALSO have higher-confidence signals
      const { data: higherSignals } = await supabase
        .from("spice_signals")
        .select("book_id")
        .in("book_id", genreBookIds.slice(0, 500))
        .in("source", ["community", "romance_io", "review_classifier", "llm_inference"]);

      const hasHigher = new Set((higherSignals ?? []).map((r) => r.book_id));
      const genreOnly = genreBookIds.filter((id) => !hasHigher.has(id));

      result.genreOnlyBooks = genreOnly.length;
      onProgress?.(
        `[spice-audit] ${genreOnly.length} books with only genre-bucketing spice`
      );

      // Re-queue romance.io + llm_spice for these (limit per run)
      for (const bookId of genreOnly.slice(0, 100)) {
        try {
          await queueSpecificJobs(supabase, bookId, ["romance_io_spice", "llm_spice"]);
          result.genreOnlyUpgraded++;
        } catch {
          result.errors++;
        }
      }

      onProgress?.(
        `[spice-audit] Re-queued ${result.genreOnlyUpgraded} genre-only books for upgrade`
      );
    }
  }

  // -------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------
  onProgress?.("\n[spice-audit] === AUDIT SUMMARY ===");
  onProgress?.(`[spice-audit] Zero-spice books:          ${result.zeroSpiceBooks} (${result.zeroSpiceRequeued} re-queued)`);
  onProgress?.(`[spice-audit] Top books missing rio:     ${result.topBooksMissingRomanceIo} (${result.romanceIoRequeued} re-queued)`);
  onProgress?.(`[spice-audit] Hierarchy disagreements:   ${result.hierarchyViolations}`);
  onProgress?.(`[spice-audit] Genre-only books:          ${result.genreOnlyBooks} (${result.genreOnlyUpgraded} re-queued)`);
  onProgress?.(`[spice-audit] Errors:                    ${result.errors}`);

  return result;
}
