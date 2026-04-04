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
import { getGoodreadsBookById, resolveToGoodreadsId, generateBookSlug } from "@/lib/books/goodreads-search";
import { saveGoodreadsBookToCache, cleanCoverUrl, stripSeriesSuffix, resolveExistingBook } from "@/lib/books/cache";
import { getAdminClient } from "@/lib/supabase/admin";
import { computeGenreBucketing } from "@/lib/spice/genre-bucketing";
import { runAuthorCrawl } from "@/lib/books/author-crawl";
import { searchBookPlaylists } from "@/lib/spotify/search";
import { detectAndSaveAudiobookStatus } from "@/lib/books/audiobook-detect";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Merge a provisional book into an existing canonical book.
 * Transfers FKs (hotlist_books, user_ratings, reading_status) from the
 * provisional row to the canonical row, then deletes the provisional.
 * Returns true if merge happened.
 */
async function mergeProvisionalIntoExisting(
  supabase: SupabaseClient,
  provisionalId: string,
  canonicalId: string
): Promise<boolean> {
  if (provisionalId === canonicalId) return false;

  console.log(`[enrichment-worker] Merging provisional ${provisionalId} into canonical ${canonicalId}`);

  // Transfer FKs — use ON CONFLICT DO NOTHING to skip if already exists
  await supabase.rpc("merge_book_references", {
    source_id: provisionalId,
    target_id: canonicalId,
  }).then(({ error }) => {
    // If the RPC doesn't exist yet, fall back to manual updates
    if (error) {
      console.warn("[enrichment-worker] merge_book_references RPC not found, using fallback");
      return Promise.all([
        supabase.from("hotlist_books").update({ book_id: canonicalId }).eq("book_id", provisionalId),
        supabase.from("user_ratings").update({ book_id: canonicalId }).eq("book_id", provisionalId),
        supabase.from("reading_status").update({ book_id: canonicalId }).eq("book_id", provisionalId),
        supabase.from("enrichment_queue").update({ book_id: canonicalId }).eq("book_id", provisionalId),
      ]);
    }
  });

  // Delete the provisional row
  const { error: deleteError } = await supabase
    .from("books")
    .delete()
    .eq("id", provisionalId);

  if (deleteError) {
    console.warn(`[enrichment-worker] Failed to delete provisional ${provisionalId}:`, deleteError.message);
    return false;
  }

  console.log(`[enrichment-worker] Merged provisional ${provisionalId} → canonical ${canonicalId}`);
  return true;
}

const JOB_DELAY_MS = 300; // Delay between scraping jobs to respect rate limits
const CONCURRENCY = 5; // Max parallel jobs within a tier

// AI-based job types that don't risk IP blocking — safe for faster throughput
const STUCK_JOB_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes — reset jobs stuck in "running"

// Spotify gets its own cap: max 3 books per cron tick.
// Each book = 2 Spotify API calls (with 5s rate limit between calls),
// so 3 books ≈ 30s of Spotify work. Prevents rate limit blowouts.
const SPOTIFY_PER_TICK_CAP = 3;

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

  // Helper to run a single job with proper outcome tracking
  async function runJob(job: QueuedJob): Promise<boolean> {
    try {
      const result = await processJob(job);
      if (result === "no-data") {
        if (job.attempts >= job.max_attempts) {
          await markJobCompleted(job.id, "no_data");
          console.log(`[enrichment-worker] ${job.job_type} for "${job.book_title}" — no data after ${job.attempts} attempts, marking complete`);
        } else {
          await markJobFailed(job.id, "no-data: external source returned no results", job.attempts);
          console.log(`[enrichment-worker] ${job.job_type} for "${job.book_title}" — no data, will retry (attempt ${job.attempts}/${job.max_attempts})`);
        }
        await updateBookEnrichmentStatus(job.book_id);
        return false;
      }
      await markJobCompleted(job.id, "data");
      await updateBookEnrichmentStatus(job.book_id);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markJobFailed(job.id, msg, job.attempts);
      console.warn(`[enrichment-worker] Job ${job.job_type} failed for "${job.book_title}": ${msg}`);
      return false;
    }
  }

  // Process each priority tier in order
  for (const tier of JOB_TYPE_PRIORITY) {
    if (timeLeft() < 5000) break;

    // Separate Spotify jobs from the rest — they need sequential
    // processing with a per-tick cap to avoid rate limit blowouts
    const nonSpotifyTypes = tier.filter((t) => t !== "spotify_playlists");
    const hasSpotify = tier.includes("spotify_playlists");

    // Process non-Spotify jobs in parallel batches (existing behavior)
    if (nonSpotifyTypes.length > 0) {
      while (timeLeft() > 5000) {
        const jobs = await claimJobs(CONCURRENCY, nonSpotifyTypes);
        if (jobs.length === 0) break;

        const results = await Promise.allSettled(jobs.map(runJob));

        for (const r of results) {
          if (r.status === "fulfilled" && r.value) {
            processed++;
          } else {
            failed++;
          }
        }

        // Delay between batches to respect external rate limits
        await new Promise((r) => setTimeout(r, JOB_DELAY_MS));
      }
    }

    // Process Spotify jobs sequentially with a per-tick cap
    if (hasSpotify && timeLeft() > 10000) {
      let spotifyCount = 0;
      while (spotifyCount < SPOTIFY_PER_TICK_CAP && timeLeft() > 10000) {
        const jobs = await claimJobs(1, ["spotify_playlists"]);
        if (jobs.length === 0) break;

        const success = await runJob(jobs[0]);
        if (success) processed++;
        else failed++;
        spotifyCount++;

        // Extra delay between Spotify jobs (on top of the in-search rate limit)
        if (spotifyCount < SPOTIFY_PER_TICK_CAP) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (spotifyCount > 0) {
        console.log(`[enrichment-worker] Processed ${spotifyCount}/${SPOTIFY_PER_TICK_CAP} Spotify jobs this tick`);
      }
    }
  }

  return { processed, failed, recovered };
}

/**
 * Process a single enrichment job.
 * Returns "data" if the job produced results, "no-data" if the external
 * source returned nothing (transient miss — should be retried).
 */
async function processJob(job: QueuedJob): Promise<"data" | "no-data"> {
  const supabase = getAdminClient();
  const { book_id, job_type, book_title, book_author, book_isbn, book_goodreads_id } = job;

  // Canon gate for Spotify: skip for non-canon books
  if (job_type === "spotify_playlists") {
    const { data: bookRow } = await supabase
      .from("books")
      .select("is_canon")
      .eq("id", book_id)
      .single();
    if (bookRow && bookRow.is_canon === false) {
      console.log(`[enrichment-worker] Skipping ${job_type} for non-canon book "${book_title}"`);
      return "no-data";
    }
  }

  console.log(`[enrichment-worker] Processing ${job_type} for "${book_title}"`);

  switch (job_type) {
    case "goodreads_detail": {
      // Resolve Goodreads ID if missing, then update the existing book row in-place
      if (!book_goodreads_id && book_title && book_author) {
        const grId = await resolveToGoodreadsId(book_title, book_author);
        if (grId) {
          // Check if another book already has this Goodreads ID (merge-on-resolve)
          const existingId = await resolveExistingBook({ goodreadsId: grId, title: book_title, author: book_author });
          if (existingId && existingId !== book_id) {
            // Another row already owns this Goodreads ID — merge provisional into it
            await mergeProvisionalIntoExisting(supabase, book_id, existingId);
            break; // Provisional is deleted, nothing more to do
          }

          const detail = await getGoodreadsBookById(grId);
          if (detail) {
            // Update the EXISTING provisional book row instead of creating a new one.
            // saveGoodreadsBookToCache upserts on goodreads_id, which would orphan
            // the provisional row (it has goodreads_id: null). So we update by book_id.
            const cleanTitle = stripSeriesSuffix(detail.title);
            const slug = generateBookSlug(cleanTitle, detail.goodreadsId);
            const cleanedCover = cleanCoverUrl(detail.coverUrl);
            const updateFields: Record<string, unknown> = {
                title: cleanTitle,
                author: detail.author,
                goodreads_id: detail.goodreadsId,
                goodreads_url: detail.goodreadsUrl ?? null,
                // Only overwrite cover when new edition has one (don't nuke existing cover)
                ...(cleanedCover && { cover_url: cleanedCover }),
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
            // Store scraped title+author as evidence for quality mismatch detection
            await supabase
              .from("enrichment_queue")
              .update({
                evidence: {
                  scraped_title: detail.title,
                  scraped_author: detail.author,
                  scraped_at: new Date().toISOString(),
                },
              })
              .eq("id", job.id);
            // Detect audiobook from new cover
            await detectAndSaveAudiobookStatus(book_id, detail.coverUrl ?? null);
          }
        }
      } else if (book_goodreads_id) {
        // Already has a Goodreads ID — re-scrape for updated data
        let detail = await getGoodreadsBookById(book_goodreads_id);

        // If this edition has no cover, try to find the canonical edition.
        // Obscure editions (new Kindle releases, etc.) often lack covers,
        // descriptions, and have unreliable ratings.
        if (detail && !cleanCoverUrl(detail.coverUrl) && book_title && book_author) {
          const canonicalId = await resolveToGoodreadsId(book_title, book_author);
          if (canonicalId && canonicalId !== book_goodreads_id) {
            console.log(`[enrichment-worker] Upgrading "${book_title}" from edition ${book_goodreads_id} to canonical ${canonicalId}`);
            const canonicalDetail = await getGoodreadsBookById(canonicalId);
            if (canonicalDetail && cleanCoverUrl(canonicalDetail.coverUrl)) {
              detail = canonicalDetail;
            }
          }
        }

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
          // Store scraped title+author as evidence for quality mismatch detection
          await supabase
            .from("enrichment_queue")
            .update({
              evidence: {
                scraped_title: detail.title,
                scraped_author: detail.author,
                scraped_at: new Date().toISOString(),
              },
            })
            .eq("id", job.id);
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
      if (!grData) return "no-data";
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
      break;
    }

    case "amazon_rating": {
      if (!book_title || !book_author) break;
      const amazonData = await getAmazonRatingViaSerper(book_title, book_author, book_isbn);
      if (!amazonData) return "no-data";
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
      break;
    }

    case "romance_io_spice": {
      if (!book_title || !book_author) break;
      const spiceData = await getRomanceIoSpice(book_title, book_author);
      if (!spiceData || (spiceData.confidence !== "high" && spiceData.confidence !== "medium")) {
        // Serper returned nothing or low-confidence match — run genre bucketing
        // as fallback, then signal no-data so the job retries
        await upsertGenreBucketing(supabase, book_id);
        return "no-data";
      }
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
      // Always run genre bucketing as a fallback signal
      await upsertGenreBucketing(supabase, book_id);
      break;
    }

    case "metadata": {
      if (!book_title || !book_author) break;
      await enrichBookMetadata(book_id, book_title, book_author, book_isbn);
      break;
    }

    case "author_crawl": {
      // Crawl author's bibliography to discover more books
      if (book_goodreads_id) {
        await runAuthorCrawl(book_goodreads_id, book_author ?? "");
      }
      break;
    }

    case "spotify_playlists": {
      if (!book_title || !book_author) break;
      // Skip if Spotify credentials aren't configured — don't waste retries
      if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) break;

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

    default:
      console.warn(`[enrichment-worker] Unknown job type: ${job_type}`);
  }

  return "data";
}
