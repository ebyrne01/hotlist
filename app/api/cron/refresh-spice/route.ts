/**
 * SPICE SIGNAL REFRESH CRON
 *
 * Runs daily to keep spice signals fresh:
 * 1. Re-aggregate community signals for books with recent user ratings
 * 2. Flag stale romance_io signals (>30 days) for re-scrape
 * 3. Recompute genre_bucketing for books with updated genres
 *
 * Schedule: daily at 4 AM UTC (see vercel.json)
 */

import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { aggregateCommunitySpice } from "@/lib/spice/community-aggregation";
import { computeGenreBucketing } from "@/lib/spice/genre-bucketing";

export const runtime = "nodejs";
export const maxDuration = 60;

const STALE_DAYS = 30;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const supabase = getAdminClient();
  const stats = {
    communityRefreshed: 0,
    staleRomanceIoQueued: 0,
    genreBucketingRefreshed: 0,
    errors: 0,
  };

  try {
    // ── Phase 1: Re-aggregate community signals (~15s budget) ──
    // Find books with user_ratings.spice_rating updated in the last 24h
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: recentRatings } = await supabase
      .from("user_ratings")
      .select("book_id")
      .not("spice_rating", "is", null)
      .gte("updated_at", yesterday);

    if (recentRatings && recentRatings.length > 0) {
      const bookIds = Array.from(new Set(recentRatings.map((r) => r.book_id)));
      console.log(`[refresh-spice] Phase 1: ${bookIds.length} books with recent ratings`);

      for (const bookId of bookIds) {
        if (Date.now() - startTime > 15_000) break;
        try {
          await aggregateCommunitySpice(bookId, supabase);
          stats.communityRefreshed++;
        } catch (err) {
          console.error(`[refresh-spice] Community agg failed for ${bookId}:`, err);
          stats.errors++;
        }
      }
    }

    // ── Phase 2: Queue stale romance_io signals for re-scrape (~5s budget) ──
    const staleDate = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleSignals } = await supabase
      .from("spice_signals")
      .select("book_id")
      .eq("source", "romance_io")
      .lt("updated_at", staleDate)
      .limit(50);

    if (staleSignals && staleSignals.length > 0) {
      console.log(`[refresh-spice] Phase 2: ${staleSignals.length} stale romance_io signals`);

      for (const row of staleSignals) {
        if (Date.now() - startTime > 25_000) break;
        try {
          // Queue a romance_io_spice enrichment job
          const { data: book } = await supabase
            .from("books")
            .select("id, title, author")
            .eq("id", row.book_id)
            .single();

          if (book) {
            await supabase.from("enrichment_queue").upsert(
              {
                book_id: book.id,
                job_type: "romance_io_spice",
                status: "pending",
                attempts: 0,
                book_title: book.title,
                book_author: book.author,
                created_at: new Date().toISOString(),
                next_attempt_at: new Date().toISOString(),
              },
              { onConflict: "book_id,job_type" }
            );
            stats.staleRomanceIoQueued++;
          }
        } catch (err) {
          console.error(`[refresh-spice] Queue romance_io failed for ${row.book_id}:`, err);
          stats.errors++;
        }
      }
    }

    // ── Phase 3: Recompute genre_bucketing for books with new genres (~25s budget) ──
    // Find books where genres were updated more recently than the genre_bucketing signal
    const { data: genreSignals } = await supabase
      .from("spice_signals")
      .select("book_id, updated_at")
      .eq("source", "genre_bucketing")
      .limit(200);

    const genreSignalMap = new Map<string, string>();
    for (const s of genreSignals ?? []) {
      genreSignalMap.set(s.book_id, s.updated_at);
    }

    // Get recently updated books with genres
    const { data: recentlyUpdatedBooks } = await supabase
      .from("books")
      .select("id, genres, updated_at")
      .not("genres", "is", null)
      .gte("updated_at", yesterday)
      .limit(100);

    if (recentlyUpdatedBooks) {
      for (const book of recentlyUpdatedBooks) {
        if (Date.now() - startTime > 50_000) break;
        const genres = book.genres as string[] | null;
        if (!genres || genres.length === 0) continue;

        const signalDate = genreSignalMap.get(book.id);
        if (signalDate && new Date(signalDate) >= new Date(book.updated_at)) continue;

        try {
          const result = computeGenreBucketing(genres);
          if (result) {
            await supabase.from("spice_signals").upsert(
              {
                book_id: book.id,
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
            stats.genreBucketingRefreshed++;
          }
        } catch (err) {
          console.error(`[refresh-spice] Genre bucketing failed for ${book.id}:`, err);
          stats.errors++;
        }
      }
    }
  } catch (err) {
    console.error("[refresh-spice] Fatal error:", err);
    return NextResponse.json(
      { error: "Internal error", stats },
      { status: 500 }
    );
  }

  const elapsed = Date.now() - startTime;
  console.log(`[refresh-spice] Done in ${elapsed}ms:`, stats);

  return NextResponse.json({ ok: true, elapsed, ...stats });
}
