/**
 * ENRICHMENT QUEUE
 *
 * Manages async enrichment jobs for books. Each job type runs independently
 * and retries on failure with exponential backoff.
 *
 * Job types:
 * - goodreads_detail: Resolve Goodreads ID + scrape detail page
 * - goodreads_rating: Scrape current rating from Goodreads
 * - amazon_rating: Look up Amazon rating via Serper
 * - romance_io_spice: Look up spice data via Serper
 * - metadata: Google Books + Open Library supplementary metadata
 * - ai_synopsis: Generate AI synopsis via Claude Haiku
 * - trope_inference: Infer tropes from genres + description
 * - review_classifier: Classify spice from review text (medium confidence)
 * - llm_spice: LLM-based spice inference from description (low confidence)
 * - author_crawl: Crawl author's full bibliography
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { scanBook, isUnderDailyLimit } from "@/lib/quality/haiku-scanner";
import { tryPromoteToCanon } from "@/lib/books/canon-gate";
import Anthropic from "@anthropic-ai/sdk";

export type JobType =
  | "goodreads_detail"
  | "goodreads_rating"
  | "amazon_rating"
  | "romance_io_spice"
  | "metadata"
  | "ai_synopsis"
  | "trope_inference"
  | "review_classifier"
  | "llm_spice"
  | "author_crawl"
  | "booktrack_prompt"
  | "spotify_playlists"
  | "ai_recommendations";

export interface QueuedJob {
  id: string;
  book_id: string;
  job_type: JobType;
  attempts: number;
  max_attempts: number;
  book_title?: string;
  book_author?: string;
  book_isbn?: string;
  book_goodreads_id?: string;
}

/**
 * Queue enrichment jobs for a book.
 * Called when a new book enters the DB (from search, Grab, seeding, etc.)
 */
export async function queueEnrichmentJobs(
  bookId: string,
  title: string,
  author: string,
  skipJobTypes?: Set<string>,
): Promise<void> {
  const supabase = getAdminClient();

  // Always include goodreads_detail — even if we have a goodreads_id, the book
  // may have been saved from search results with minimal data (no description,
  // cover, genres). The worker re-scrapes when goodreads_id exists.
  const allJobs: JobType[] = [
    "goodreads_detail", "goodreads_rating", "amazon_rating", "romance_io_spice",
    "metadata", "ai_synopsis", "trope_inference", "review_classifier", "llm_spice",
    "booktrack_prompt", "spotify_playlists", "ai_recommendations",
  ];

  const jobs = skipJobTypes
    ? allJobs.filter((j) => !skipJobTypes.has(j))
    : allJobs;

  // Serper-dependent jobs get more retries — transient Google index misses are common
  const SERPER_JOBS = new Set<JobType>(["romance_io_spice", "amazon_rating", "goodreads_rating"]);

  const rows = jobs.map((jobType) => ({
    book_id: bookId,
    job_type: jobType,
    status: "pending",
    attempts: 0,
    max_attempts: SERPER_JOBS.has(jobType) ? 5 : 3,
    next_retry_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("enrichment_queue")
    .upsert(rows, { onConflict: "book_id,job_type" });

  if (error) {
    console.warn(`[enrichment-queue] Failed to queue jobs for "${title}":`, error.message);
  } else {
    console.log(`[enrichment-queue] Queued ${jobs.length} jobs for "${title}" by ${author}`);
  }
}

/**
 * Job type priority tiers — processed in order so users see
 * the most valuable data (ratings, spice) first.
 */
export const JOB_TYPE_PRIORITY: JobType[][] = [
  // Tier 1: Ratings + spice — what users see immediately
  ["goodreads_rating", "amazon_rating", "romance_io_spice", "llm_spice"],
  // Tier 2: Core data + tropes — covers, descriptions, ISBNs, trope tags
  ["goodreads_detail", "metadata", "trope_inference", "review_classifier"],
  // Tier 3: Nice-to-have enrichments
  ["ai_synopsis", "author_crawl", "booktrack_prompt", "spotify_playlists", "ai_recommendations"],
];

/**
 * Atomically claim a batch of pending/failed jobs.
 * Uses FOR UPDATE SKIP LOCKED in Postgres to prevent two workers
 * from claiming the same job (race condition fix).
 * Marks jobs as 'running' and increments attempts in one step.
 */
export async function claimJobs(
  limit: number = 10,
  jobTypes?: JobType[]
): Promise<QueuedJob[]> {
  const supabase = getAdminClient();

  const { data, error } = await supabase.rpc("claim_enrichment_jobs", {
    p_limit: limit,
    p_job_types: jobTypes ?? null,
  });

  if (error) {
    console.warn("[enrichment-queue] Failed to claim jobs:", error.message);
    return [];
  }

  if (!data || data.length === 0) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    id: row.id,
    book_id: row.book_id,
    job_type: row.job_type as JobType,
    attempts: row.attempts,
    max_attempts: row.max_attempts ?? 3,
    book_title: row.book_title,
    book_author: row.book_author,
    book_isbn: row.book_isbn,
    book_goodreads_id: row.book_goodreads_id,
  }));
}

/**
 * @deprecated Use claimJobs() instead — it atomically fetches + marks running.
 * Kept for backwards compatibility with any external callers.
 */
export async function fetchPendingJobs(
  limit: number = 10,
  jobTypes?: JobType[]
): Promise<QueuedJob[]> {
  return claimJobs(limit, jobTypes);
}

/**
 * @deprecated Use claimJobs() instead — it atomically marks jobs running.
 * Kept for backwards compatibility with any external callers.
 */
export async function markJobRunning(jobId: string): Promise<void> {
  // No-op — claimJobs already marks the job as running
  void jobId;
}

/**
 * Mark a job as completed.
 * @param outcome - 'data' if the job produced results, 'no_data' if the source had nothing
 */
export async function markJobCompleted(
  jobId: string,
  outcome: "data" | "no_data" = "data"
): Promise<void> {
  const supabase = getAdminClient();
  await supabase
    .from("enrichment_queue")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      outcome,
    })
    .eq("id", jobId);
}

/**
 * Mark a job as failed. Sets next_retry_at with exponential backoff.
 * Rate limit errors get a much longer backoff (1-4 hours) to avoid
 * hammering APIs that are actively throttling us.
 */
export async function markJobFailed(
  jobId: string,
  errorMessage: string,
  attempts: number
): Promise<void> {
  const supabase = getAdminClient();

  const isRateLimited = errorMessage.toLowerCase().includes("rate limit");

  // Rate-limited jobs: 1h, 2h, 4h — way longer than normal backoff
  // Normal jobs: 30s, 2min, 10min
  const backoffMs = isRateLimited
    ? Math.min(3_600_000 * Math.pow(2, attempts - 1), 14_400_000) // 1h → 4h max
    : Math.min(30_000 * Math.pow(4, attempts), 600_000); // 30s → 10min max

  await supabase
    .from("enrichment_queue")
    .update({
      status: "failed",
      error_message: errorMessage,
      outcome: "error",
      next_retry_at: new Date(Date.now() + backoffMs).toISOString(),
    })
    .eq("id", jobId);
}

/**
 * Bonus job types that should NOT block enrichment status.
 * These are nice-to-have enrichments — if they fail or are pending,
 * the book should still be marked "complete" once core jobs finish.
 */
const BONUS_JOB_TYPES: JobType[] = ["spotify_playlists", "booktrack_prompt", "ai_synopsis", "ai_recommendations"];

/**
 * Update a book's enrichment_status based on its completed jobs.
 * Excludes bonus job types (Spotify, booktrack) from the status calculation
 * so they don't block books from reaching "complete".
 */
export async function updateBookEnrichmentStatus(bookId: string): Promise<void> {
  const supabase = getAdminClient();

  const { data: jobs } = await supabase
    .from("enrichment_queue")
    .select("status, job_type")
    .eq("book_id", bookId);

  if (!jobs || jobs.length === 0) return;

  // Only consider core jobs for status calculation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coreJobs = jobs.filter((j: any) => !BONUS_JOB_TYPES.includes(j.job_type));

  if (coreJobs.length === 0) return;

  // A job is "done" if it completed or permanently failed (exhausted retries).
  // Failed jobs should not block a book from reaching "complete" status.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allDone = coreJobs.every((j: any) => j.status === "completed" || j.status === "failed");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const someComplete = coreJobs.some((j: any) => j.status === "completed");

  const status = allDone && someComplete ? "complete" : someComplete ? "partial" : "pending";

  await supabase
    .from("books")
    .update({ enrichment_status: status })
    .eq("id", bookId);

  // Post-enrichment hooks when a book reaches "complete"
  if (status === "complete") {
    try {
      if (await isUnderDailyLimit()) {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
        await scanBook(client, bookId);
      }
    } catch (err) {
      console.warn("[post-enrichment] Haiku scan failed:", err);
    }

    try {
      await tryPromoteToCanon(bookId);
    } catch (err) {
      console.warn("[post-enrichment] Canon promotion failed:", err);
    }
  }
}
