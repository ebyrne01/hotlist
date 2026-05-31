/**
 * REPAIR TOP LIST GAPS
 *
 * Reads a top-list coverage audit JSON and turns the P0/P1 actions into a
 * controlled repair batch.
 *
 * Dry run:
 *   npm run repair:top-list-gaps -- scripts/audit-reports/top-list-coverage-...json
 *
 * Apply:
 *   npm run repair:top-list-gaps -- scripts/audit-reports/top-list-coverage-...json --apply
 *
 * Defaults to P0 only. Use --priority P1 to include P0 + P1.
 */

import { config as loadEnv } from "dotenv";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { evaluateCanonReadiness, tryPromoteToCanon } from "@/lib/books/canon-gate";
import {
  getGoodreadsBookById,
  generateBookSlug,
  resolveToGoodreadsId,
} from "@/lib/books/goodreads-search";
import { cleanCoverUrl, stripSeriesSuffix } from "@/lib/books/cache";
import { shouldSkipQuery, cacheResult } from "@/lib/scraping/serper-cache";
import type { JobType } from "@/lib/enrichment/queue";

loadEnv({ path: ".env.local", quiet: true });

type Priority = "P0" | "P1" | "P2" | "P3";

type AuditRow = {
  rank: number;
  priority: Priority;
  action: string;
  inputTitle: string;
  inputAuthor: string;
  inputSource: string;
  asin: string | null;
  matched: boolean;
  bookId: string | null;
  canon: boolean | null;
  hasGoodreadsId: boolean;
  hasGoodreadsRating: boolean;
  hasAmazonRating: boolean;
  hasRomanceIoSpice: boolean;
  amazonHarvestRating: number | null;
  goodreadsHarvestRating: number | null;
  romanceIoHarvestSpice: number | null;
  isJunk: boolean;
  isFocused: boolean;
};

type AuditReport = {
  summary?: Record<string, unknown>;
  rows: AuditRow[];
};

type RepairPlanItem = {
  row: AuditRow;
  bookId: string;
  queueJobs: JobType[];
  upserts: string[];
  directFixes: string[];
  canonReady: boolean;
  canonBlockers: string[];
  shouldTryPromote: boolean;
  paidSerperJobs: JobType[];
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_ENDPOINT = "https://google.serper.dev/search";
const GOODREADS_SERPER_QUERIES_PER_DIRECT_FIX = 3;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type SerperOrganicResult = {
  title?: string;
  link?: string;
  snippet?: string;
};

type SerperResponse = {
  organic?: SerperOrganicResult[];
};

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const directOnly = args.includes("--direct-only");
  const noQueue = args.includes("--no-queue");
  const priorityArgIndex = args.indexOf("--priority");
  const priority = (
    priorityArgIndex >= 0 ? args[priorityArgIndex + 1] : "P0"
  ) as Priority;
  const limitArgIndex = args.indexOf("--limit");
  const limit = limitArgIndex >= 0 ? Number(args[limitArgIndex + 1]) : null;
  const consumed = new Set<string>(["--apply", "--direct-only", "--no-queue"]);
  if (priorityArgIndex >= 0) {
    consumed.add("--priority");
    if (args[priorityArgIndex + 1]) consumed.add(args[priorityArgIndex + 1]);
  }
  if (limitArgIndex >= 0) {
    consumed.add("--limit");
    if (args[limitArgIndex + 1]) consumed.add(args[limitArgIndex + 1]);
  }
  const reportPath = args.find(
    (arg) => !consumed.has(arg) && !arg.startsWith("--") && !["P0", "P1", "P2", "P3"].includes(arg)
  );

  return {
    apply,
    priority: ["P0", "P1", "P2", "P3"].includes(priority) ? priority : "P0",
    limit: Number.isFinite(limit) && limit && limit > 0 ? limit : null,
    directOnly,
    noQueue,
    reportPath: reportPath ?? latestReportPath(),
  };
}

function latestReportPath(): string {
  const dir = join(process.cwd(), "scripts", "audit-reports");
  const files = readdirSync(dir)
    .filter((file) => file.startsWith("top-list-coverage-") && file.endsWith(".json"))
    .sort();
  const latest = files.at(-1);
  if (!latest) {
    throw new Error("No top-list coverage report found in scripts/audit-reports");
  }
  return join(dir, latest);
}

function priorityRank(priority: Priority): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[priority];
}

function shouldInclude(row: AuditRow, maxPriority: Priority): boolean {
  return (
    priorityRank(row.priority) <= priorityRank(maxPriority) &&
    row.priority !== "P3" &&
    row.action !== "covered" &&
    !row.isJunk &&
    row.isFocused &&
    Boolean(row.bookId)
  );
}

function topListDemandFor(row: AuditRow) {
  return {
    rank: row.rank,
    focused: row.isFocused,
    source: row.inputSource,
    hasAmazonEvidence: Boolean(row.asin || row.amazonHarvestRating || row.hasAmazonRating),
  };
}

function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantWords(text: string): string[] {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "book",
    "edition",
    "for",
    "from",
    "in",
    "novel",
    "of",
    "the",
    "to",
    "volume",
    "with",
  ]);

  return normalizeForSearch(text)
    .split(" ")
    .filter((word) => word.length > 1 && !stopWords.has(word));
}

function baseTitleForSearch(title: string): string {
  return stripSeriesSuffix(title)
    .replace(/\([^)]*\)/g, " ")
    .split(/[:|]/)[0]
    .replace(/\s+/g, " ")
    .trim();
}

function authorLastName(author: string): string {
  const words = significantWords(author);
  return words.at(-1) ?? "";
}

function parseGoodreadsId(link: string): string | null {
  const match = link.match(/goodreads\.com\/(?:[a-z]{2}\/)?book\/show\/(\d+)/i);
  return match?.[1] ?? null;
}

function resultLooksLikeBook(row: AuditRow, result: SerperOrganicResult): boolean {
  const link = result.link ?? "";
  if (!parseGoodreadsId(link)) return false;

  const baseTitle = baseTitleForSearch(row.inputTitle);
  const titleWords = significantWords(baseTitle);
  const haystack = normalizeForSearch(
    `${result.title ?? ""} ${result.snippet ?? ""} ${decodeURIComponent(link)}`
  );

  const matchedTitleWords = titleWords.filter((word) =>
    new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack)
  ).length;
  const titlePass =
    titleWords.length <= 1
      ? matchedTitleWords === titleWords.length
      : matchedTitleWords >= Math.min(2, titleWords.length) &&
        matchedTitleWords / titleWords.length >= 0.5;

  const lastName = authorLastName(row.inputAuthor);
  const fullAuthor = normalizeForSearch(row.inputAuthor);
  const authorPass =
    !lastName ||
    new RegExp(`\\b${lastName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack) ||
    haystack.includes(fullAuthor);

  return titlePass && authorPass;
}

async function searchGoodreadsIdViaSerper(row: AuditRow): Promise<string | null> {
  if (!SERPER_API_KEY) return null;

  const title = baseTitleForSearch(row.inputTitle);
  if (!title || !row.inputAuthor) return null;

  const queries = [
    `site:goodreads.com/book/show "${title}" "${row.inputAuthor}"`,
    `site:goodreads.com/book/show "${title}" "${row.inputAuthor}" "by"`,
    `Goodreads "${row.inputTitle}" "${row.inputAuthor}"`,
  ];

  for (const query of queries) {
    if (await shouldSkipQuery(query)) continue;

    try {
      const response = await fetch(SERPER_ENDPOINT, {
        method: "POST",
        headers: {
          "X-API-KEY": SERPER_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, num: 5 }),
      });

      if (!response.ok) {
        await cacheResult(query, "error");
        continue;
      }

      const json = (await response.json()) as SerperResponse;
      const match = (json.organic ?? []).find((result) => resultLooksLikeBook(row, result));
      if (!match?.link) {
        await cacheResult(query, "no_data");
        continue;
      }

      const goodreadsId = parseGoodreadsId(match.link);
      if (!goodreadsId) {
        await cacheResult(query, "no_data");
        continue;
      }

      await cacheResult(query, "hit");
      return goodreadsId;
    } catch (error) {
      console.warn(
        `[repair-top-list-gaps] Goodreads Serper lookup failed for ${row.inputTitle}:`,
        error instanceof Error ? error.message : error
      );
      await cacheResult(query, "error");
    }
  }

  return null;
}

async function getActiveJobs(bookId: string): Promise<Set<JobType>> {
  const { data, error } = await supabase
    .from("enrichment_queue")
    .select("job_type,status")
    .eq("book_id", bookId)
    .in("status", ["pending", "running"]);

  if (error) throw error;
  return new Set((data ?? []).map((job) => job.job_type as JobType));
}

function jobNeeds(row: AuditRow, canonReady: boolean): JobType[] {
  const jobs = new Set<JobType>();

  if (!row.hasGoodreadsId) {
    jobs.add("goodreads_detail");
  }
  if (!row.hasGoodreadsRating && row.goodreadsHarvestRating == null) {
    jobs.add("goodreads_rating");
  }

  // Paid jobs should only be queued when the row is already canon or ready to
  // become canon in this repair pass; the worker has the same spend guard.
  const canQueuePaid = row.canon === true || canonReady;

  if (canQueuePaid && !row.hasRomanceIoSpice && row.romanceIoHarvestSpice == null) {
    jobs.add("romance_io_spice");
  }
  if (canQueuePaid && !row.hasAmazonRating && row.amazonHarvestRating == null) {
    jobs.add("amazon_rating");
  }

  return Array.from(jobs);
}

async function buildPlan(
  rows: AuditRow[],
  maxPriority: Priority,
  limit: number | null,
  directOnly: boolean,
  noQueue: boolean
) {
  const eligibleRows = rows
    .filter((row) => shouldInclude(row, maxPriority))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.rank - b.rank)
    .slice(0, limit ?? undefined);

  const plan: RepairPlanItem[] = [];

  for (const row of eligibleRows) {
    const bookId = row.bookId!;
    const readiness = await evaluateCanonReadiness(bookId, {
      topListDemand: topListDemandFor(row),
    });
    const activeJobs = await getActiveJobs(bookId);
    const jobs = jobNeeds(row, readiness.ready).filter((job) => !activeJobs.has(job));
    const upserts: string[] = [];
    const directFixes: string[] = [];

    if (!row.hasAmazonRating && row.amazonHarvestRating != null) {
      upserts.push("amazon_rating_from_harvest");
    }
    if (!row.hasGoodreadsRating && row.goodreadsHarvestRating != null) {
      upserts.push("goodreads_rating_from_harvest");
    }
    if (!row.hasRomanceIoSpice && row.romanceIoHarvestSpice != null) {
      upserts.push("romance_io_spice_from_harvest");
    }
    if (row.asin) {
      upserts.push("amazon_asin");
    }
    if (!row.hasGoodreadsId) {
      directFixes.push("resolve_goodreads_id");
    }

    if (directOnly && directFixes.length === 0) {
      continue;
    }

    plan.push({
      row,
      bookId,
      queueJobs: directOnly || noQueue ? [] : jobs,
      upserts: directOnly ? [] : upserts,
      directFixes,
      canonReady: readiness.ready,
      canonBlockers: readiness.blockers,
      shouldTryPromote: row.canon === false && readiness.ready,
      paidSerperJobs: directOnly || noQueue
        ? []
        : jobs.filter((job) => job === "amazon_rating" || job === "romance_io_spice"),
    });
  }

  return plan;
}

async function upsertHarvestData(item: RepairPlanItem) {
  const now = new Date().toISOString();
  const row = item.row;

  if (row.asin) {
    await supabase
      .from("books")
      .update({ amazon_asin: row.asin, updated_at: now })
      .eq("id", item.bookId)
      .is("amazon_asin", null);
  }

  if (!row.hasAmazonRating && row.amazonHarvestRating != null) {
    await supabase.from("book_ratings").upsert(
      {
        book_id: item.bookId,
        source: "amazon",
        rating: row.amazonHarvestRating,
        scraped_at: now,
      },
      { onConflict: "book_id,source" }
    );
  }

  if (!row.hasGoodreadsRating && row.goodreadsHarvestRating != null) {
    await supabase.from("book_ratings").upsert(
      {
        book_id: item.bookId,
        source: "goodreads",
        rating: row.goodreadsHarvestRating,
        scraped_at: now,
      },
      { onConflict: "book_id,source" }
    );
  }

  if (!row.hasRomanceIoSpice && row.romanceIoHarvestSpice != null) {
    await supabase.from("spice_signals").upsert(
      {
        book_id: item.bookId,
        source: "romance_io",
        spice_value: row.romanceIoHarvestSpice,
        confidence: 0.6,
        evidence: {
          repaired_from_top_list: true,
          input_source: row.inputSource,
          repaired_at: now,
        },
      },
      { onConflict: "book_id,source" }
    );
  }
}

async function moveSourceRows(
  table: string,
  sourceId: string,
  targetId: string,
  conflictColumns: string[]
) {
  const { data: rows, error } = await supabase
    .from(table)
    .select("*")
    .eq("book_id", sourceId);

  if (error) throw error;

  for (const row of rows ?? []) {
    const conflictQuery = conflictColumns.reduce(
      (query, column) => query.eq(column, row[column]),
      supabase.from(table).select("book_id").eq("book_id", targetId)
    );
    const { data: existing, error: existingError } = await conflictQuery.maybeSingle();
    if (existingError) throw existingError;

    if (existing) {
      const deleteQuery = conflictColumns.reduce(
        (query, column) => query.eq(column, row[column]),
        supabase.from(table).delete().eq("book_id", sourceId)
      );
      await deleteQuery;
    } else {
      const updateQuery = conflictColumns.reduce(
        (query, column) => query.eq(column, row[column]),
        supabase.from(table).update({ book_id: targetId }).eq("book_id", sourceId)
      );
      await updateQuery;
    }
  }
}

async function mergeDuplicateIntoGoodreadsOwner(
  sourceId: string,
  targetId: string,
  row: AuditRow
): Promise<boolean> {
  if (sourceId === targetId) return false;

  const { data: sourceBook, error: sourceError } = await supabase
    .from("books")
    .select("id,title,author,is_canon,amazon_asin")
    .eq("id", sourceId)
    .single();
  if (sourceError) throw sourceError;

  const { data: targetBook, error: targetError } = await supabase
    .from("books")
    .select("id,title,author,is_canon,amazon_asin")
    .eq("id", targetId)
    .single();
  if (targetError) throw targetError;

  if (sourceBook.is_canon === true && targetBook.is_canon !== true) {
    console.warn(
      `[repair-top-list-gaps] Refusing to merge canon source ${sourceId} into non-canon target ${targetId}`
    );
    return false;
  }

  if (!targetBook.amazon_asin && (row.asin || sourceBook.amazon_asin)) {
    const { error: asinError } = await supabase
      .from("books")
      .update({
        amazon_asin: row.asin ?? sourceBook.amazon_asin,
        updated_at: new Date().toISOString(),
      })
      .eq("id", targetId);
    if (asinError) throw asinError;
  }

  await moveSourceRows("book_ratings", sourceId, targetId, ["source"]);
  await moveSourceRows("spice_signals", sourceId, targetId, ["source"]);
  await moveSourceRows("book_tropes", sourceId, targetId, ["trope_id"]);

  const { error: rpcError } = await supabase.rpc("merge_book_references", {
    source_id: sourceId,
    target_id: targetId,
  });
  if (rpcError) {
    console.warn(
      `[repair-top-list-gaps] merge_book_references RPC failed; continuing with direct delete: ${rpcError.message}`
    );
  }

  const { error: deleteError } = await supabase.from("books").delete().eq("id", sourceId);
  if (deleteError) {
    console.warn(
      `[repair-top-list-gaps] Failed to delete duplicate ${sourceId}: ${deleteError.message}`
    );
    return false;
  }

  console.log(
    `[repair-top-list-gaps] Merged duplicate "${sourceBook.title}" (${sourceId}) into Goodreads owner "${targetBook.title}" (${targetId})`
  );
  return true;
}

async function resolveGoodreadsIdentity(item: RepairPlanItem): Promise<boolean> {
  if (item.row.hasGoodreadsId) return false;

  const goodreadsId = (await resolveToGoodreadsId(
    item.row.inputTitle,
    item.row.inputAuthor,
    { fuzzy: true }
  )) ?? (await searchGoodreadsIdViaSerper(item.row));
  if (!goodreadsId) return false;

  const { data: existingOwner, error: ownerError } = await supabase
    .from("books")
    .select("id")
    .eq("goodreads_id", goodreadsId)
    .neq("id", item.bookId)
    .maybeSingle();

  if (ownerError) throw ownerError;
  if (existingOwner) {
    return mergeDuplicateIntoGoodreadsOwner(item.bookId, existingOwner.id, item.row);
  }

  const detail = await getGoodreadsBookById(goodreadsId);
  const now = new Date().toISOString();

  if (!detail) {
    const { error } = await supabase
      .from("books")
      .update({
        goodreads_id: goodreadsId,
        goodreads_url: `https://www.goodreads.com/book/show/${goodreadsId}`,
        updated_at: now,
      })
      .eq("id", item.bookId)
      .is("goodreads_id", null);

    if (error) throw error;
    return true;
  }

  const cleanedTitle = stripSeriesSuffix(detail.title);
  const cleanedCover = cleanCoverUrl(detail.coverUrl);
  const updateFields: Record<string, unknown> = {
    title: cleanedTitle,
    author: detail.author,
    goodreads_id: detail.goodreadsId,
    goodreads_url: detail.goodreadsUrl ?? null,
    description: detail.description ?? null,
    published_year: detail.publishedYear ?? null,
    page_count: detail.pageCount ?? null,
    genres: detail.genres ?? [],
    slug: generateBookSlug(cleanedTitle, detail.goodreadsId),
    metadata_source: "goodreads",
    enrichment_status: "partial",
    data_refreshed_at: now,
    updated_at: now,
  };

  if (cleanedCover) updateFields.cover_url = cleanedCover;
  if (detail.seriesName) updateFields.series_name = detail.seriesName;
  if (detail.seriesPosition) updateFields.series_position = detail.seriesPosition;

  const { error } = await supabase
    .from("books")
    .update(updateFields)
    .eq("id", item.bookId)
    .is("goodreads_id", null);

  if (error) throw error;

  if (detail.rating) {
    await supabase.from("book_ratings").upsert(
      {
        book_id: item.bookId,
        source: "goodreads",
        rating: detail.rating,
        rating_count: detail.ratingCount ?? null,
        scraped_at: now,
      },
      { onConflict: "book_id,source" }
    );
  }

  return true;
}

async function queueJobs(item: RepairPlanItem) {
  if (item.queueJobs.length === 0) return;

  const rows = item.queueJobs.map((jobType) => ({
    book_id: item.bookId,
    job_type: jobType,
    status: "pending",
    attempts: 0,
    max_attempts: ["goodreads_rating", "amazon_rating", "romance_io_spice"].includes(jobType)
      ? 5
      : 3,
    next_retry_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("enrichment_queue")
    .upsert(rows, { onConflict: "book_id,job_type" });

  if (error) throw error;
}

function summarizePlan(plan: RepairPlanItem[]) {
  const queuedCounts: Record<string, number> = {};
  const upsertCounts: Record<string, number> = {};
  let promoteAttempts = 0;
  let paidSerperJobs = 0;
  const directFixCounts: Record<string, number> = {};
  let estimatedGoodreadsSerperQueries = 0;

  for (const item of plan) {
    for (const job of item.queueJobs) queuedCounts[job] = (queuedCounts[job] ?? 0) + 1;
    for (const upsert of item.upserts) upsertCounts[upsert] = (upsertCounts[upsert] ?? 0) + 1;
    for (const fix of item.directFixes) directFixCounts[fix] = (directFixCounts[fix] ?? 0) + 1;
    if (item.shouldTryPromote) promoteAttempts++;
    paidSerperJobs += item.paidSerperJobs.length;
    if (item.directFixes.includes("resolve_goodreads_id")) {
      estimatedGoodreadsSerperQueries += GOODREADS_SERPER_QUERIES_PER_DIRECT_FIX;
    }
  }

  return {
    rows: plan.length,
    promoteAttempts,
    queuedCounts,
    upsertCounts,
    directFixCounts,
    estimatedPaidSerperJobs: paidSerperJobs,
    estimatedGoodreadsSerperQueries,
  };
}

async function main() {
  const { apply, priority, limit, directOnly, noQueue, reportPath } = parseArgs();
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as AuditReport;
  const plan = await buildPlan(report.rows, priority, limit, directOnly, noQueue);
  const summary = summarizePlan(plan);

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry_run",
        reportPath,
        maxPriority: priority,
        limit,
        directOnly,
        noQueue,
        ...summary,
      },
      null,
      2
    )
  );

  console.log("\nPlanned rows:");
  for (const item of plan.slice(0, 40)) {
    console.log(
      `  ${item.row.priority} #${item.row.rank} ${item.row.action}: ${item.row.inputTitle} by ${item.row.inputAuthor}` +
        ` | jobs=${item.queueJobs.join(",") || "-"} upserts=${item.upserts.join(",") || "-"}` +
        ` direct=${item.directFixes.join(",") || "-"}` +
        ` promote=${item.shouldTryPromote ? "yes" : "no"} blockers=${item.canonBlockers.join(",") || "-"}`
    );
  }

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to write changes.");
    return;
  }

  let promoted = 0;
  let queued = 0;
  let upsertedRows = 0;
  let goodreadsResolved = 0;

  for (const item of plan) {
    await upsertHarvestData(item);
    if (item.upserts.length > 0) upsertedRows++;

    if (item.directFixes.includes("resolve_goodreads_id")) {
      const resolved = await resolveGoodreadsIdentity(item);
      if (resolved) goodreadsResolved++;
    }

    const postFixReadiness =
      item.row.canon === false
        ? await evaluateCanonReadiness(item.bookId, {
            topListDemand: topListDemandFor(item.row),
          })
        : null;

    if (item.shouldTryPromote || postFixReadiness?.ready) {
      const didPromote = await tryPromoteToCanon(item.bookId, {
        topListDemand: topListDemandFor(item.row),
      });
      if (didPromote) promoted++;
    }

    await queueJobs(item);
    queued += item.queueJobs.length;
  }

  console.log(
    JSON.stringify(
      {
        applied: true,
        rowsTouched: plan.length,
        rowsWithHarvestUpserts: upsertedRows,
        goodreadsResolved,
        promoted,
        queuedJobs: queued,
        estimatedPaidSerperJobs: summary.estimatedPaidSerperJobs,
        estimatedGoodreadsSerperQueries: summary.estimatedGoodreadsSerperQueries,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[repair-top-list-gaps] Fatal error:", error);
  process.exit(1);
});
