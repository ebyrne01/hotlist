/**
 * ENRICHMENT WORKER
 *
 * Processes pending enrichment jobs from the queue.
 * Each job type calls the appropriate enrichment function.
 * Runs with a time budget (for Vercel's 60s function limit).
 */

import {
  fetchPendingJobs,
  markJobRunning,
  markJobCompleted,
  markJobFailed,
  updateBookEnrichmentStatus,
  type QueuedJob,
} from "./queue";

import { scrapeGoodreadsRating } from "@/lib/scraping/goodreads";
import { getAmazonRatingViaSerper } from "@/lib/scraping/amazon-search";
import { getRomanceIoSpice } from "@/lib/scraping/romance-io-search";
import { enrichBookMetadata } from "@/lib/books/metadata-enrichment";
import { generateSynopsis } from "@/lib/books/ai-synopsis";
import { getGoodreadsBookById, resolveToGoodreadsId } from "@/lib/books/goodreads-search";
import { saveGoodreadsBookToCache } from "@/lib/books/cache";
import { getAdminClient } from "@/lib/supabase/admin";

const JOB_DELAY_MS = 500; // Delay between jobs to respect rate limits

/**
 * Process pending enrichment jobs.
 * Returns the number of jobs processed.
 */
export async function processEnrichmentQueue(
  timeBudgetMs: number = 50_000
): Promise<{ processed: number; failed: number }> {
  const startTime = Date.now();
  let processed = 0;
  let failed = 0;

  while (Date.now() - startTime < timeBudgetMs) {
    const jobs = await fetchPendingJobs(5);
    if (jobs.length === 0) break;

    for (const job of jobs) {
      if (Date.now() - startTime > timeBudgetMs - 5000) break; // Leave 5s buffer

      try {
        await markJobRunning(job.id);
        await processJob(job);
        await markJobCompleted(job.id);
        await updateBookEnrichmentStatus(job.book_id);
        processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await markJobFailed(job.id, msg, job.attempts);
        failed++;
        console.warn(`[enrichment-worker] Job ${job.job_type} failed for "${job.book_title}": ${msg}`);
      }

      // Small delay between jobs
      await new Promise((r) => setTimeout(r, JOB_DELAY_MS));
    }
  }

  return { processed, failed };
}

/**
 * Process a single enrichment job.
 */
async function processJob(job: QueuedJob): Promise<void> {
  const supabase = getAdminClient();
  const { book_id, job_type, book_title, book_author, book_isbn, book_goodreads_id } = job;

  console.log(`[enrichment-worker] Processing ${job_type} for "${book_title}"`);

  switch (job_type) {
    case "goodreads_detail": {
      // Resolve Goodreads ID if missing, then scrape detail
      if (!book_goodreads_id && book_title && book_author) {
        const grId = await resolveToGoodreadsId(book_title, book_author);
        if (grId) {
          const detail = await getGoodreadsBookById(grId);
          if (detail) {
            await saveGoodreadsBookToCache({
              title: detail.title,
              author: detail.author,
              goodreadsId: detail.goodreadsId,
              goodreadsUrl: detail.goodreadsUrl,
              coverUrl: detail.coverUrl,
              description: detail.description,
              seriesName: detail.seriesName,
              seriesPosition: detail.seriesPosition,
              publishedYear: detail.publishedYear,
              pageCount: detail.pageCount,
              genres: detail.genres,
            });
          }
        }
      }
      break;
    }

    case "goodreads_rating": {
      if (!book_title || !book_author) break;
      const grData = await scrapeGoodreadsRating(book_title, book_author);
      if (grData) {
        await supabase.from("book_ratings").upsert(
          {
            book_id,
            source: "goodreads",
            rating: grData.rating,
            rating_count: grData.ratingCount,
            scraped_at: new Date().toISOString(),
          },
          { onConflict: "book_id,source" }
        );
      }
      break;
    }

    case "amazon_rating": {
      if (!book_title || !book_author) break;
      const amazonData = await getAmazonRatingViaSerper(book_title, book_author, book_isbn);
      if (amazonData && amazonData.rating > 0) {
        await supabase.from("book_ratings").upsert(
          {
            book_id,
            source: "amazon",
            rating: amazonData.rating,
            rating_count: amazonData.ratingCount,
            scraped_at: new Date().toISOString(),
          },
          { onConflict: "book_id,source" }
        );
        if (amazonData.asin) {
          await supabase.from("books").update({ amazon_asin: amazonData.asin }).eq("id", book_id);
        }
      }
      break;
    }

    case "romance_io_spice": {
      if (!book_title || !book_author) break;
      const spiceData = await getRomanceIoSpice(book_title, book_author);
      if (spiceData && spiceData.confidence === "high") {
        await supabase.from("book_spice").upsert(
          {
            book_id,
            source: "romance_io",
            spice_level: spiceData.spiceLevel,
            confidence: "high",
            scraped_at: new Date().toISOString(),
          },
          { onConflict: "book_id,source" }
        );
        await supabase.from("books").update({
          romance_io_slug: spiceData.romanceIoSlug,
          romance_io_heat_label: spiceData.heatLabel,
        }).eq("id", book_id);
      }
      break;
    }

    case "metadata": {
      if (!book_title || !book_author) break;
      await enrichBookMetadata(book_id, book_title, book_author, book_isbn);
      break;
    }

    case "ai_synopsis": {
      const { data: bookRow } = await supabase
        .from("books")
        .select("description, ai_synopsis")
        .eq("id", book_id)
        .single();

      if (bookRow?.description && !bookRow.ai_synopsis && bookRow.description.length >= 20) {
        await generateSynopsis({
          id: book_id,
          title: book_title ?? "",
          author: book_author ?? "",
          description: bookRow.description,
          aiSynopsis: null,
          tropes: [],
        });
        // Synopsis is saved inside generateSynopsis
      }
      break;
    }

    case "trope_inference": {
      // Tropes are inferred during Goodreads detail scrape (from genres).
      // This job type exists as a placeholder for future community trope tagging.
      break;
    }

    default:
      console.warn(`[enrichment-worker] Unknown job type: ${job_type}`);
  }
}
