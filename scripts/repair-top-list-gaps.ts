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
  canonReady: boolean;
  canonBlockers: string[];
  shouldTryPromote: boolean;
  paidSerperJobs: JobType[];
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const priorityArgIndex = args.indexOf("--priority");
  const priority = (
    priorityArgIndex >= 0 ? args[priorityArgIndex + 1] : "P0"
  ) as Priority;
  const limitArgIndex = args.indexOf("--limit");
  const limit = limitArgIndex >= 0 ? Number(args[limitArgIndex + 1]) : null;
  const reportPath = args.find((arg) => !arg.startsWith("--") && !["P0", "P1", "P2", "P3"].includes(arg));

  return {
    apply,
    priority: ["P0", "P1", "P2", "P3"].includes(priority) ? priority : "P0",
    limit: Number.isFinite(limit) && limit && limit > 0 ? limit : null,
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

async function buildPlan(rows: AuditRow[], maxPriority: Priority, limit: number | null) {
  const eligibleRows = rows
    .filter((row) => shouldInclude(row, maxPriority))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.rank - b.rank)
    .slice(0, limit ?? undefined);

  const plan: RepairPlanItem[] = [];

  for (const row of eligibleRows) {
    const bookId = row.bookId!;
    const readiness = await evaluateCanonReadiness(bookId);
    const activeJobs = await getActiveJobs(bookId);
    const jobs = jobNeeds(row, readiness.ready).filter((job) => !activeJobs.has(job));
    const upserts: string[] = [];

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

    plan.push({
      row,
      bookId,
      queueJobs: jobs,
      upserts,
      canonReady: readiness.ready,
      canonBlockers: readiness.blockers,
      shouldTryPromote: row.canon === false && readiness.ready,
      paidSerperJobs: jobs.filter((job) => job === "amazon_rating" || job === "romance_io_spice"),
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

  for (const item of plan) {
    for (const job of item.queueJobs) queuedCounts[job] = (queuedCounts[job] ?? 0) + 1;
    for (const upsert of item.upserts) upsertCounts[upsert] = (upsertCounts[upsert] ?? 0) + 1;
    if (item.shouldTryPromote) promoteAttempts++;
    paidSerperJobs += item.paidSerperJobs.length;
  }

  return {
    rows: plan.length,
    promoteAttempts,
    queuedCounts,
    upsertCounts,
    estimatedPaidSerperJobs: paidSerperJobs,
  };
}

async function main() {
  const { apply, priority, limit, reportPath } = parseArgs();
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as AuditReport;
  const plan = await buildPlan(report.rows, priority, limit);
  const summary = summarizePlan(plan);

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry_run",
        reportPath,
        maxPriority: priority,
        limit,
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

  for (const item of plan) {
    await upsertHarvestData(item);
    if (item.upserts.length > 0) upsertedRows++;

    if (item.shouldTryPromote) {
      const didPromote = await tryPromoteToCanon(item.bookId);
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
        promoted,
        queuedJobs: queued,
        estimatedPaidSerperJobs: summary.estimatedPaidSerperJobs,
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
