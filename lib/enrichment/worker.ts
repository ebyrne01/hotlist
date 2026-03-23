/**
 * ENRICHMENT WORKER
 *
 * Processes pending enrichment jobs from the queue.
 * Each job type calls the appropriate enrichment function.
 * Runs with a time budget (for Vercel's 60s function limit).
 */

import {
  claimJobs,
  JOB_TYPE_PRIORITY,
  markJobCompleted,
  markJobFailed,
  updateBookEnrichmentStatus,
  type QueuedJob,
} from "./queue";

import { scrapeGoodreadsRating } from "@/lib/scraping/goodreads";
import { getAmazonRatingViaSerper } from "@/lib/scraping/amazon-search";
import { getRomanceIoSpice } from "@/lib/scraping/romance-io-search";
import { classifyRomanceIoTags } from "@/lib/scraping/romance-io-tags";
import { enrichBookMetadata } from "@/lib/books/metadata-enrichment";
import { generateSynopsis } from "@/lib/books/ai-synopsis";
import { getGoodreadsBookById, resolveToGoodreadsId, generateBookSlug } from "@/lib/books/goodreads-search";
import { saveGoodreadsBookToCache, cleanCoverUrl, stripSeriesSuffix } from "@/lib/books/cache";
import { getAdminClient } from "@/lib/supabase/admin";
import { computeGenreBucketing } from "@/lib/spice/genre-bucketing";
import { inferAndUpsertSpice } from "@/lib/spice/llm-inference";
import { classifyReviews } from "@/lib/spice/review-classifier";
import { inferAndUpsertTropes } from "@/lib/spice/trope-inference";
import { fetchAllReviews } from "@/lib/spice/review-fetcher";
import { runAuthorCrawl } from "@/lib/books/author-crawl";
import { generateReadingVibes } from "@/lib/books/reading-vibes";
import { searchBookPlaylists } from "@/lib/spotify/search";
import { generateRecommendations } from "@/lib/books/ai-recommendations";
import { detectAndSaveAudiobookStatus } from "@/lib/books/audiobook-detect";

import type { SupabaseClient } from "@supabase/supabase-js";

const JOB_DELAY_MS = 300; // Delay between jobs to respect rate limits
const CONCURRENCY = 3; // Max parallel jobs within a tier
const STUCK_JOB_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes — reset jobs stuck in "running"

/**
 * Fetch genres for a book and upsert a genre_bucketing spice signal.
 * Safe to call even if the book has no genres — it's a no-op in that case.
 */
async function upsertGenreBucketing(supabase: SupabaseClient, bookId: string) {
  const { data: bookRow } = await supabase
    .from("books")
    .select("genres")
    .eq("id", bookId)
    .single();

  const genres: string[] = bookRow?.genres ?? [];
  if (genres.length === 0) return;

  const result = computeGenreBucketing(genres);
  if (!result) return;

  await supabase.from("spice_signals").upsert(
    {
      book_id: bookId,
      source: "genre_bucketing",
      spice_value: result.spice,
      confidence: result.confidence,
      evidence: {
        matched_tags: result.matchedTags,
        total_genres: genres.length,
        computed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "book_id,source" }
  );

  console.log(
    `[enrichment-worker] Genre bucketing for book ${bookId}: spice=${result.spice}, confidence=${result.confidence}, tags=${result.matchedTags.join(", ")}`
  );
}

/**
 * Reset jobs stuck in "running" for longer than STUCK_JOB_THRESHOLD_MS.
 * This handles workers that crashed mid-job (Vercel timeout, OOM, etc.).
 */
async function recoverStuckJobs(): Promise<number> {
  const supabase = getAdminClient();
  const cutoff = new Date(Date.now() - STUCK_JOB_THRESHOLD_MS).toISOString();

  const { data, error } = await supabase
    .from("enrichment_queue")
    .update({
      status: "pending",
      error_message: "auto-recovered: stuck in running state",
      next_retry_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("last_attempt_at", cutoff)
    .select("id");

  if (error) {
    console.warn("[enrichment-worker] Failed to recover stuck jobs:", error.message);
    return 0;
  }

  const count = data?.length ?? 0;
  if (count > 0) {
    console.log(`[enrichment-worker] Recovered ${count} stuck jobs`);
  }
  return count;
}

/**
 * Process pending enrichment jobs in priority order.
 * Tier 1 (ratings + spice) runs first, then tier 2 (tropes + reviews),
 * then tier 3 (metadata + synopsis). Newest jobs first within each tier.
 *
 * Jobs within a tier run in parallel (up to CONCURRENCY at once).
 */
export async function processEnrichmentQueue(
  timeBudgetMs: number = 50_000
): Promise<{ processed: number; failed: number; recovered: number }> {
  const startTime = Date.now();
  let processed = 0;
  let failed = 0;

  function timeLeft() {
    return timeBudgetMs - (Date.now() - startTime);
  }

  // Auto-recover stuck jobs before processing
  const recovered = await recoverStuckJobs();

  // Process each priority tier in order
  for (const tier of JOB_TYPE_PRIORITY) {
    if (timeLeft() < 5000) break;

    while (timeLeft() > 5000) {
      // Claim a batch of jobs for this tier
      const jobs = await claimJobs(CONCURRENCY, tier);
      if (jobs.length === 0) break;

      // Process the batch in parallel
      const results = await Promise.allSettled(
        jobs.map(async (job) => {
          try {
            await processJob(job);
            await markJobCompleted(job.id);
            await updateBookEnrichmentStatus(job.book_id);
            return { success: true } as const;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await markJobFailed(job.id, msg, job.attempts);
            console.warn(`[enrichment-worker] Job ${job.job_type} failed for "${job.book_title}": ${msg}`);
            return { success: false } as const;
          }
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled" && r.value.success) {
          processed++;
        } else {
          failed++;
        }
      }

      // Small delay between batches to respect rate limits
      await new Promise((r) => setTimeout(r, JOB_DELAY_MS));
    }
  }

  return { processed, failed, recovered };
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
      // Resolve Goodreads ID if missing, then update the existing book row in-place
      if (!book_goodreads_id && book_title && book_author) {
        const grId = await resolveToGoodreadsId(book_title, book_author);
        if (grId) {
          const detail = await getGoodreadsBookById(grId);
          if (detail) {
            // Update the EXISTING provisional book row instead of creating a new one.
            // saveGoodreadsBookToCache upserts on goodreads_id, which would orphan
            // the provisional row (it has goodreads_id: null). So we update by book_id.
            const cleanTitle = stripSeriesSuffix(detail.title);
            const slug = generateBookSlug(cleanTitle, detail.goodreadsId);
            const updateFields: Record<string, unknown> = {
                title: cleanTitle,
                author: detail.author,
                goodreads_id: detail.goodreadsId,
                goodreads_url: detail.goodreadsUrl ?? null,
                cover_url: cleanCoverUrl(detail.coverUrl),
                description: detail.description ?? null,
                published_year: detail.publishedYear ?? null,
                page_count: detail.pageCount ?? null,
                genres: detail.genres ?? [],
                slug,
                metadata_source: "goodreads",
                enrichment_status: "partial",
                data_refreshed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            // Only overwrite series fields when scraper actually found data
            if (detail.seriesName) updateFields.series_name = detail.seriesName;
            if (detail.seriesPosition) updateFields.series_position = detail.seriesPosition;
            await supabase
              .from("books")
              .update(updateFields)
              .eq("id", book_id);
            // Detect audiobook from new cover
            await detectAndSaveAudiobookStatus(book_id, detail.coverUrl ?? null);
          }
        }
      } else if (book_goodreads_id) {
        // Already has a Goodreads ID — re-scrape for updated data
        const detail = await getGoodreadsBookById(book_goodreads_id);
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
          // Detect audiobook from cover
          await detectAndSaveAudiobookStatus(book_id, detail.coverUrl ?? null);
        }
      }
      // Run genre bucketing after Goodreads genres are saved
      await upsertGenreBucketing(supabase, book_id);
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
      if (amazonData) {
        // Save ASIN even when rating extraction fails — ASINs power affiliate buy links
        if (amazonData.asin) {
          await supabase.from("books").update({ amazon_asin: amazonData.asin }).eq("id", book_id);
        }
        if (amazonData.rating > 0) {
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
        }
      }
      break;
    }

    case "romance_io_spice": {
      if (!book_title || !book_author) break;
      const spiceData = await getRomanceIoSpice(book_title, book_author);
      if (spiceData && (spiceData.confidence === "high" || spiceData.confidence === "medium")) {
        const signalConfidence = spiceData.confidence === "high" ? 0.85 : 0.7;
        // Store in legacy book_spice table
        await supabase.from("book_spice").upsert(
          {
            book_id,
            source: "romance_io",
            spice_level: spiceData.spiceLevel,
            confidence: spiceData.confidence,
            scraped_at: new Date().toISOString(),
          },
          { onConflict: "book_id,source" }
        );
        // Store in new spice_signals table
        await supabase.from("spice_signals").upsert(
          {
            book_id,
            source: "romance_io",
            spice_value: spiceData.spiceLevel,
            confidence: signalConfidence,
            evidence: {
              heat_label: spiceData.heatLabel,
              match_confidence: spiceData.confidence,
              scraped_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "book_id,source" }
        );
        // Store the star rating if the scraper found one
        if (spiceData.romanceIoRating && spiceData.romanceIoRating > 0) {
          await supabase.from("book_ratings").upsert(
            {
              book_id,
              source: "romance_io",
              rating: spiceData.romanceIoRating,
              rating_count: null,
              scraped_at: new Date().toISOString(),
            },
            { onConflict: "book_id,source" }
          );
        }
        await supabase.from("books").update({
          romance_io_slug: spiceData.romanceIoSlug,
          romance_io_heat_label: spiceData.heatLabel,
        }).eq("id", book_id);

        // Store romance.io tags as tropes (if any)
        if (spiceData.rawTags && spiceData.rawTags.length > 0) {
          const classified = classifyRomanceIoTags(spiceData.rawTags);
          if (classified.tropes.length > 0) {
            // Look up canonical trope IDs
            const { data: tropeRows } = await supabase
              .from("tropes")
              .select("id, slug")
              .in("slug", classified.tropes.map((t) => t.canonicalSlug));

            if (tropeRows && tropeRows.length > 0) {
              const tropeInserts = tropeRows.map((tr) => ({
                book_id,
                trope_id: tr.id,
                source: "romance_io",
              }));

              // Upsert to avoid duplicates
              await supabase
                .from("book_tropes")
                .upsert(tropeInserts, { onConflict: "book_id,trope_id" });
            }
          }
        }
      }
      // Always run genre bucketing as a fallback signal
      await upsertGenreBucketing(supabase, book_id);
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
      // Run genre bucketing as a spice signal
      await upsertGenreBucketing(supabase, book_id);

      // Run LLM-based trope inference from description
      const { data: bookForTropes } = await supabase
        .from("books")
        .select("description, genres")
        .eq("id", book_id)
        .single();

      if (bookForTropes?.description) {
        await inferAndUpsertTropes(book_id, {
          title: book_title ?? "",
          author: book_author ?? "",
          description: bookForTropes.description,
          genres: bookForTropes.genres ?? [],
        });
      }
      break;
    }

    case "review_classifier": {
      // Classify spice from review text (Goodreads + Amazon snippets)
      const { data: bookRow } = await supabase
        .from("books")
        .select("goodreads_url, amazon_asin")
        .eq("id", book_id)
        .single();

      const reviews = await fetchAllReviews({
        goodreadsUrl: bookRow?.goodreads_url,
        title: book_title ?? "",
        author: book_author ?? "",
        amazonAsin: bookRow?.amazon_asin,
      });

      if (reviews.length >= 2) {
        const result = await classifyReviews(
          reviews,
          book_title ?? "",
          book_author ?? ""
        );
        if (result) {
          await supabase.from("spice_signals").upsert(
            {
              book_id,
              source: "review_classifier",
              spice_value: result.spice,
              confidence: result.confidence,
              evidence: {
                method: result.method,
                reviews_analyzed: result.reviewsAnalyzed,
                keyword_hits: result.keywordHits,
                per_review_scores: result.perReviewScores,
                reasoning: result.reasoning ?? null,
                classified_at: new Date().toISOString(),
              },
              updated_at: new Date().toISOString(),
            },
            { onConflict: "book_id,source" }
          );
        }
      }
      break;
    }

    case "llm_spice": {
      // LLM inference — only runs if no higher-confidence signal exists
      const { data: bookRow } = await supabase
        .from("books")
        .select("description, genres")
        .eq("id", book_id)
        .single();

      if (bookRow?.description) {
        await inferAndUpsertSpice(book_id, {
          title: book_title ?? "",
          author: book_author ?? "",
          description: bookRow.description,
          genres: bookRow.genres ?? [],
        });
      }
      break;
    }

    case "author_crawl": {
      // Crawl author's bibliography to discover more books
      if (book_goodreads_id) {
        await runAuthorCrawl(book_goodreads_id, book_author ?? "");
      }
      break;
    }

    case "booktrack_prompt": {
      // Generate AI reading vibes prompt — needs tropes + synopsis for context
      const { data: bookRow } = await supabase
        .from("books")
        .select("description, ai_synopsis, genres, booktrack_prompt")
        .eq("id", book_id)
        .single();

      // Skip if already generated
      if (bookRow?.booktrack_prompt) break;

      // Get tropes for this book
      const { data: bookTropes } = await supabase
        .from("book_tropes")
        .select("tropes(name)")
        .eq("book_id", book_id);

      const tropes = (bookTropes ?? [])
        .map((bt: Record<string, unknown>) =>
          ((bt.tropes as Record<string, unknown>)?.name as string) ?? ""
        )
        .filter(Boolean);

      // Get best available spice signal
      const { data: spiceSignal } = await supabase
        .from("spice_signals")
        .select("spice_value")
        .eq("book_id", book_id)
        .in("source", ["community", "romance_io", "llm_inference"])
        .order("confidence", { ascending: false })
        .limit(1)
        .single();

      const synopsis =
        (bookRow?.ai_synopsis as string) ?? (bookRow?.description as string) ?? null;

      // Not enough context yet — throw so the job retries after synopsis/tropes populate
      if (!synopsis && tropes.length === 0) {
        throw new Error("No synopsis or tropes yet — will retry after enrichment progresses");
      }

      const result = await generateReadingVibes({
        title: book_title ?? "",
        author: book_author ?? "",
        tropes,
        spiceLevel: (spiceSignal?.spice_value as number) ?? null,
        synopsis,
        genres: (bookRow?.genres as string[]) ?? [],
      });

      if (result) {
        await supabase
          .from("books")
          .update({
            booktrack_prompt: result.prompt,
            booktrack_moods: result.moodTags,
          })
          .eq("id", book_id);
      }
      break;
    }

    case "spotify_playlists": {
      if (!book_title || !book_author) break;

      const playlists = await searchBookPlaylists(book_title, book_author);

      await supabase
        .from("books")
        .update({
          spotify_playlists: playlists.length > 0 ? playlists : null,
          spotify_fetched_at: new Date().toISOString(),
        })
        .eq("id", book_id);
      break;
    }

    case "ai_recommendations": {
      if (!book_title || !book_author) break;

      const { data: recBook } = await supabase
        .from("books")
        .select("id, title, author, description, genres, series_name")
        .eq("id", book_id)
        .single();

      if (recBook) {
        // Fetch tropes and spice for context
        const [{ data: tropeRows }, { data: spiceRows }] = await Promise.all([
          supabase
            .from("book_tropes")
            .select("tropes(name)")
            .eq("book_id", book_id),
          supabase
            .from("spice_signals")
            .select("spice_value, confidence")
            .eq("book_id", book_id)
            .in("source", ["community", "romance_io"])
            .order("confidence", { ascending: false })
            .limit(1),
        ]);

        const tropes = (tropeRows
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?.map((r: any) => r.tropes?.name as string | undefined)
          .filter(Boolean) ?? []) as string[];
        const spiceLevel = spiceRows?.[0]?.spice_value ?? null;

        await generateRecommendations({
          id: recBook.id,
          title: recBook.title,
          author: recBook.author,
          description: recBook.description,
          genres: recBook.genres ?? [],
          seriesName: recBook.series_name,
          tropes,
          spiceLevel,
        });
      }
      break;
    }

    default:
      console.warn(`[enrichment-worker] Unknown job type: ${job_type}`);
  }
}
