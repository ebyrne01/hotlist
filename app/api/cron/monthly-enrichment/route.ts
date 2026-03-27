/**
 * CRON JOB 2 — Monthly Enrichment Refresh
 *
 * Runs on the 1st of each month at 2am UTC.
 * Re-fetches Goodreads ratings and Amazon ASINs for stale books.
 *
 * Skips: synopsis (never refresh), spice (never refresh), romance.io (never refresh).
 * Time budget: 55 seconds max (Vercel hobby plan limit).
 * Processes in batches of 50 with 2s delays.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth, cronUnauthorized } from "@/lib/api/cron-auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { scrapeGoodreadsRating } from "@/lib/scraping/goodreads";
import { getAmazonRatingViaSerper } from "@/lib/scraping/amazon-search";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIME_BUDGET_MS = 55_000;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 2000;

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request)) {
    return cronUnauthorized();
  }

  const startTime = Date.now();
  const supabase = getAdminClient();
  const errors: string[] = [];
  let booksUpdated = 0;

  // Log start
  const { data: logRow } = await supabase
    .from("cron_logs")
    .insert({ job_name: "monthly-enrichment", status: "running" })
    .select("id")
    .single();
  const logId = logRow?.id;

  function timeRemaining(): number {
    return TIME_BUDGET_MS - (Date.now() - startTime);
  }

  try {
    // Find books where enrichment is stale (>30 days) or never done
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleBooks } = await supabase
      .from("books")
      .select("id, title, author, isbn, amazon_asin, goodreads_id")
      .not("goodreads_id", "like", "unknown-%")
      .or(`last_enriched_at.is.null,last_enriched_at.lt.${thirtyDaysAgo}`)
      .order("last_enriched_at", { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE);

    if (!staleBooks || staleBooks.length === 0) {
      if (logId) {
        await supabase
          .from("cron_logs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            books_updated: 0,
          })
          .eq("id", logId);
      }
      return NextResponse.json({
        status: "completed",
        books_updated: 0,
        message: "No stale books found",
        duration_ms: Date.now() - startTime,
      });
    }

    // Process each book: re-fetch Goodreads rating + Amazon ASIN
    for (const book of staleBooks) {
      if (timeRemaining() < 5_000) break;

      try {
        let updated = false;

        // Re-fetch Goodreads rating
        const grData = await scrapeGoodreadsRating(book.title, book.author);
        if (grData) {
          await supabase.from("book_ratings").upsert(
            {
              book_id: book.id,
              source: "goodreads",
              rating: grData.rating,
              rating_count: grData.ratingCount,
              scraped_at: new Date().toISOString(),
            },
            { onConflict: "book_id,source" }
          );
          updated = true;
        }

        // Re-fetch Amazon ASIN if missing
        if (!book.amazon_asin && timeRemaining() > 5_000) {
          const amazonData = await getAmazonRatingViaSerper(
            book.title,
            book.author,
            book.isbn
          );
          if (amazonData) {
            await supabase.from("book_ratings").upsert(
              {
                book_id: book.id,
                source: "amazon",
                rating: amazonData.rating,
                rating_count: amazonData.ratingCount,
                scraped_at: new Date().toISOString(),
              },
              { onConflict: "book_id,source" }
            );
            if (amazonData.asin) {
              await supabase
                .from("books")
                .update({ amazon_asin: amazonData.asin })
                .eq("id", book.id);
            }
            updated = true;
          }
        }

        // Mark as enriched
        if (updated) {
          await supabase
            .from("books")
            .update({ last_enriched_at: new Date().toISOString() })
            .eq("id", book.id);
          booksUpdated++;
        }
      } catch (err) {
        errors.push(`${book.title}: ${String(err)}`);
      }

      // Small delay between books to respect rate limits
      if (timeRemaining() > 5_000) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    // Log completion
    if (logId) {
      await supabase
        .from("cron_logs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          books_updated: booksUpdated,
          errors: errors.length > 0 ? errors : [],
        })
        .eq("id", logId);
    }

    return NextResponse.json({
      status: "completed",
      books_updated: booksUpdated,
      stale_found: staleBooks.length,
      errors: errors.length,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    if (logId) {
      await supabase
        .from("cron_logs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          errors: [...errors, String(err)],
        })
        .eq("id", logId);
    }

    return NextResponse.json(
      { status: "failed", error: String(err), books_updated: booksUpdated },
      { status: 500 }
    );
  }
}
