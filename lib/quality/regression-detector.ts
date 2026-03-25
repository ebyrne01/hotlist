/**
 * POST-BATCH REGRESSION DETECTOR
 *
 * When a discovery channel creates many books at once, run the rules engine
 * on each and flag if the batch has an abnormally high P0 count.
 * Catches the "301 non-romance books" scenario before it accumulates.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { runRulesEngine, type BookForQuality, type QualityFlagInsert } from "./rules-engine";

interface BatchResult {
  source: string;
  bookCount: number;
  flagsCreated: number;
  p0Count: number;
  warning: string | null;
}

interface RegressionSummary {
  batchesChecked: number;
  warnings: string[];
  batches: BatchResult[];
}

/**
 * Check all discovery batches from the past week for quality regressions.
 * Groups recently-created books by discovery_source and runs the rules engine
 * on batches of 10+. Warns if any batch has > 3 P0 flags.
 */
export async function detectBatchRegressions(): Promise<RegressionSummary> {
  const supabase = getAdminClient();

  // Find discovery sources that created 10+ books in the past week
  const { data: batches } = await supabase
    .rpc("get_recent_discovery_batches", { lookback_days: 7, min_batch_size: 10 })
    .then((res) => {
      if (res.error) {
        // RPC may not exist yet — fall back to raw query
        return { data: null, error: res.error };
      }
      return res;
    });

  // Fallback: query directly if RPC doesn't exist
  const sourceBatches: { source: string; book_ids: string[] }[] = [];

  if (batches) {
    for (const b of batches as { discovery_source: string; book_ids: string[] }[]) {
      sourceBatches.push({ source: b.discovery_source, book_ids: b.book_ids });
    }
  } else {
    // Direct query: group recent books by discovery_source
    const { data: recentBooks } = await supabase
      .from("books")
      .select("id, discovery_source")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .not("discovery_source", "is", null);

    if (recentBooks) {
      const bySource = new Map<string, string[]>();
      for (const b of recentBooks) {
        const src = b.discovery_source as string;
        if (!bySource.has(src)) bySource.set(src, []);
        bySource.get(src)!.push(b.id as string);
      }
      bySource.forEach((ids, source) => {
        if (ids.length >= 10) {
          sourceBatches.push({ source, book_ids: ids });
        }
      });
    }
  }

  const warnings: string[] = [];
  const results: BatchResult[] = [];

  for (const batch of sourceBatches) {
    const result = await checkBatch(batch.book_ids, batch.source);
    results.push(result);
    if (result.warning) warnings.push(result.warning);
  }

  return {
    batchesChecked: sourceBatches.length,
    warnings,
    batches: results,
  };
}

/**
 * Run the rules engine against a batch of book IDs.
 */
async function checkBatch(
  bookIds: string[],
  source: string
): Promise<BatchResult> {
  const supabase = getAdminClient();

  const { data: books } = await supabase
    .from("books")
    .select("id, title, author, series_name, series_position, ai_synopsis, page_count, published_year")
    .in("id", bookIds);

  if (!books || books.length === 0) {
    return { source, bookCount: bookIds.length, flagsCreated: 0, p0Count: 0, warning: null };
  }

  let totalFlags = 0;
  let p0Count = 0;

  for (const book of books) {
    const bookForQuality: BookForQuality = {
      id: book.id as string,
      title: book.title as string,
      author: book.author as string,
      series_name: book.series_name as string | null,
      series_position: book.series_position as string | null,
      ai_synopsis: book.ai_synopsis as string | null,
      page_count: book.page_count as number | null,
      published_year: book.published_year as number | null,
    };

    const flags = runRulesEngine(bookForQuality);
    if (flags.length === 0) continue;

    totalFlags += flags.length;
    p0Count += flags.filter((f: QualityFlagInsert) => f.priority === "P0").length;

    // Insert flags (idempotent — unique index prevents duplicates)
    for (const flag of flags) {
      await supabase.from("quality_flags").upsert(
        {
          book_id: flag.book_id,
          field_name: flag.field_name,
          issue_type: flag.issue_type,
          source: flag.source,
          priority: flag.priority,
          rule_id: flag.rule_id,
          confidence: flag.confidence,
          original_value: flag.original_value,
          suggested_value: flag.suggested_value,
          auto_fixable: flag.auto_fixable,
          status: "open",
        },
        { onConflict: "book_id,field_name,issue_type", ignoreDuplicates: true }
      );
    }
  }

  const warning = p0Count > 3
    ? `${source}: batch of ${bookIds.length} books has ${p0Count} P0 flags (${totalFlags} total). Review immediately.`
    : null;

  if (warning) {
    console.warn(`[regression-detector] WARNING: ${warning}`);
  } else {
    console.log(`[regression-detector] ${source}: ${bookIds.length} books, ${totalFlags} flags (${p0Count} P0) — OK`);
  }

  return { source, bookCount: bookIds.length, flagsCreated: totalFlags, p0Count, warning };
}
