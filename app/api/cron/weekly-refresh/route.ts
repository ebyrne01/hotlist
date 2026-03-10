/**
 * CRON JOB 1 — Weekly Refresh
 *
 * Runs every Tuesday at 10am UTC (after NYT updates).
 * Discovers new romance books from NYT bestsellers and Google Books new releases.
 * Inserts new books with goodreads_id and queues enrichment.
 *
 * Target: 20-50 new books per week.
 * Time budget: 55 seconds max (Vercel hobby plan limit).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  resolveToGoodreadsId,
  getGoodreadsBookById,
} from "@/lib/books/goodreads-search";
import { saveGoodreadsBookToCache } from "@/lib/books/cache";
import { scheduleEnrichment } from "@/lib/scraping";
import { scheduleMetadataEnrichment } from "@/lib/books/metadata-enrichment";
import { isJunkTitle, isKnownRomanceAuthor } from "@/lib/books/romance-filter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NYT_LISTS = [
  "hardcover-fiction",
  "mass-market-paperback",
  "trade-fiction-paperback",
] as const;

const GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes";
const GOOGLE_QUERIES = [
  "subject:romance",
  "subject:fantasy+romance",
  "subject:romantic+fiction",
] as const;

const TIME_BUDGET_MS = 55_000; // 55 seconds

export async function GET(request: NextRequest) {
  // Auth: Vercel cron sends CRON_SECRET, or allow dev
  const authHeader = request.headers.get("authorization");
  const isDev = process.env.NODE_ENV === "development";
  if (!isDev && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const supabase = getAdminClient();
  const errors: string[] = [];
  let booksAdded = 0;

  // Log start
  const { data: logRow } = await supabase
    .from("cron_logs")
    .insert({ job_name: "weekly-refresh", status: "running" })
    .select("id")
    .single();
  const logId = logRow?.id;

  function timeRemaining(): number {
    return TIME_BUDGET_MS - (Date.now() - startTime);
  }

  try {
    // ── PART 1: NYT Bestsellers ──────────────────────────

    const apiKey = process.env.NYT_BOOKS_API_KEY;
    if (apiKey && timeRemaining() > 15_000) {
      for (const listName of NYT_LISTS) {
        if (timeRemaining() < 10_000) break;

        try {
          const url = `https://api.nytimes.com/svc/books/v3/lists/current/${listName}.json?api-key=${apiKey}`;
          const res = await fetch(url);
          if (!res.ok) continue;

          const data = await res.json();
          const books = data.results?.books ?? [];

          for (const nytBook of books) {
            if (timeRemaining() < 8_000) break;
            if (isJunkTitle(nytBook.title)) continue;
            if (!isKnownRomanceAuthor(nytBook.author)) continue;

            // Check if we already have this book
            const { data: existing } = await supabase
              .from("books")
              .select("id")
              .ilike("title", nytBook.title)
              .limit(1)
              .single();
            if (existing) continue;

            // Resolve to Goodreads
            const goodreadsId = await resolveToGoodreadsId(nytBook.title, nytBook.author);
            if (!goodreadsId) continue;

            // Check if already stored by goodreads_id
            const { data: byGr } = await supabase
              .from("books")
              .select("id")
              .eq("goodreads_id", goodreadsId)
              .single();
            if (byGr) continue;

            const grDetail = await getGoodreadsBookById(goodreadsId);
            if (!grDetail) continue;

            const saved = await saveGoodreadsBookToCache({
              title: grDetail.title,
              author: grDetail.author,
              goodreadsId: grDetail.goodreadsId,
              goodreadsUrl: grDetail.goodreadsUrl,
              coverUrl: nytBook.book_image || grDetail.coverUrl,
              description: grDetail.description,
              seriesName: grDetail.seriesName,
              seriesPosition: grDetail.seriesPosition,
              publishedYear: grDetail.publishedYear,
              pageCount: grDetail.pageCount,
              genres: grDetail.genres,
              isbn13: nytBook.primary_isbn13 || undefined,
              isbn: nytBook.primary_isbn10 || undefined,
            });

            if (saved) {
              booksAdded++;
              scheduleEnrichment(saved.id, saved.title, saved.author, saved.isbn);
              scheduleMetadataEnrichment(saved.id, saved.title, saved.author, saved.isbn);
            }
          }

          await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
          errors.push(`NYT ${listName}: ${String(err)}`);
        }
      }
    }

    // ── PART 2: Google Books New Releases ────────────────

    if (timeRemaining() > 15_000) {
      const googleApiKey = process.env.GOOGLE_BOOKS_API_KEY;

      for (const query of GOOGLE_QUERIES) {
        if (timeRemaining() < 8_000) break;

        try {
          const params = new URLSearchParams({
            q: query,
            orderBy: "newest",
            maxResults: "20",
            printType: "books",
            langRestrict: "en",
          });
          if (googleApiKey) params.set("key", googleApiKey);

          const res = await fetch(`${GOOGLE_BOOKS_URL}?${params}`);
          if (!res.ok) continue;

          const data = await res.json();
          const volumes = data.items ?? [];

          for (const vol of volumes) {
            if (timeRemaining() < 5_000) break;

            const info = vol.volumeInfo;
            if (!info?.title || !info?.authors?.length) continue;

            const title = info.title;
            const author = info.authors.join(", ");
            if (isJunkTitle(title)) continue;

            // Check if romance
            const categories = info.categories ?? [];
            const descLower = (info.description ?? "").toLowerCase();
            const isRomance =
              categories.some((c: string) => c.toLowerCase().includes("romance")) ||
              ["romance", "love story", "romantic", "enemies to lovers"].some((kw) => descLower.includes(kw)) ||
              isKnownRomanceAuthor(author);
            if (!isRomance) continue;

            // Published in last 30 days?
            const pubDate = info.publishedDate;
            if (pubDate) {
              const pubTime = new Date(pubDate).getTime();
              const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
              if (pubTime < thirtyDaysAgo) continue;
            }

            // Check if already in DB
            const { data: existing } = await supabase
              .from("books")
              .select("id")
              .ilike("title", title)
              .limit(1)
              .single();
            if (existing) continue;

            // Resolve to Goodreads (required for storage)
            const goodreadsId = await resolveToGoodreadsId(title, author);
            if (!goodreadsId) continue;

            const { data: byGr } = await supabase
              .from("books")
              .select("id")
              .eq("goodreads_id", goodreadsId)
              .single();
            if (byGr) continue;

            const grDetail = await getGoodreadsBookById(goodreadsId);
            if (!grDetail) continue;

            const saved = await saveGoodreadsBookToCache({
              title: grDetail.title,
              author: grDetail.author,
              goodreadsId: grDetail.goodreadsId,
              goodreadsUrl: grDetail.goodreadsUrl,
              coverUrl: grDetail.coverUrl,
              description: grDetail.description,
              seriesName: grDetail.seriesName,
              seriesPosition: grDetail.seriesPosition,
              publishedYear: grDetail.publishedYear,
              pageCount: grDetail.pageCount,
              genres: grDetail.genres,
            });

            if (saved) {
              booksAdded++;
              scheduleEnrichment(saved.id, saved.title, saved.author, saved.isbn);
              scheduleMetadataEnrichment(saved.id, saved.title, saved.author, saved.isbn);
            }
          }

          await new Promise((r) => setTimeout(r, 300));
        } catch (err) {
          errors.push(`Google ${query}: ${String(err)}`);
        }
      }
    }

    // ── PART 3: Google Books Subject Discovery (older popular books) ──

    const GB_DISCOVERY_QUERIES = [
      "subject:romance",
      "subject:romantic fiction",
      "subject:love stories",
      "subject:fantasy romance",
    ];

    if (timeRemaining() > 12_000) {
      // Rotate through queries week by week
      const { data: gbCounterRow } = await supabase
        .from("homepage_cache")
        .select("fetched_at")
        .eq("cache_key", "gb_discovery_counter")
        .single();

      let gbQueryIndex = 0;
      if (gbCounterRow) {
        const last = new Date(gbCounterRow.fetched_at);
        gbQueryIndex =
          (last.getMilliseconds() + 1) % GB_DISCOVERY_QUERIES.length;
      }

      const discoveryQuery = GB_DISCOVERY_QUERIES[gbQueryIndex];
      const googleApiKey = process.env.GOOGLE_BOOKS_API_KEY;

      try {
        const params = new URLSearchParams({
          q: discoveryQuery,
          orderBy: "relevance",
          maxResults: "20",
          printType: "books",
          langRestrict: "en",
        });
        if (googleApiKey) params.set("key", googleApiKey);

        const res = await fetch(`${GOOGLE_BOOKS_URL}?${params}`);
        if (res.ok) {
          const data = await res.json();
          const volumes = data.items ?? [];

          for (const vol of volumes) {
            if (timeRemaining() < 5_000) break;

            const info = vol.volumeInfo;
            if (!info?.title || !info?.authors?.length) continue;

            const title = info.title;
            const author = info.authors.join(", ");
            if (isJunkTitle(title)) continue;

            // Check if romance
            const categories = info.categories ?? [];
            const descLower = (info.description ?? "").toLowerCase();
            const isRomance =
              categories.some((c: string) =>
                c.toLowerCase().includes("romance")
              ) ||
              [
                "romance",
                "love story",
                "romantic",
                "enemies to lovers",
              ].some((kw) => descLower.includes(kw)) ||
              isKnownRomanceAuthor(author);
            if (!isRomance) continue;

            // Check if already in DB by title
            const { data: existing } = await supabase
              .from("books")
              .select("id")
              .ilike("title", title)
              .limit(1)
              .single();
            if (existing) continue;

            // Resolve to Goodreads
            const goodreadsId = await resolveToGoodreadsId(title, author);
            if (!goodreadsId) continue;

            const { data: byGr } = await supabase
              .from("books")
              .select("id")
              .eq("goodreads_id", goodreadsId)
              .single();
            if (byGr) continue;

            const grDetail = await getGoodreadsBookById(goodreadsId);
            if (!grDetail) continue;

            const saved = await saveGoodreadsBookToCache({
              title: grDetail.title,
              author: grDetail.author,
              goodreadsId: grDetail.goodreadsId,
              goodreadsUrl: grDetail.goodreadsUrl,
              coverUrl: grDetail.coverUrl,
              description: grDetail.description,
              seriesName: grDetail.seriesName,
              seriesPosition: grDetail.seriesPosition,
              publishedYear: grDetail.publishedYear,
              pageCount: grDetail.pageCount,
              genres: grDetail.genres,
            });

            if (saved) {
              booksAdded++;
              scheduleEnrichment(
                saved.id,
                saved.title,
                saved.author,
                saved.isbn
              );
              scheduleMetadataEnrichment(
                saved.id,
                saved.title,
                saved.author,
                saved.isbn
              );
            }
          }
        }

        // Save counter for next week
        const counterTs = new Date();
        counterTs.setMilliseconds(gbQueryIndex);
        await supabase.from("homepage_cache").upsert(
          {
            cache_key: "gb_discovery_counter",
            book_ids: [],
            fetched_at: counterTs.toISOString(),
          },
          { onConflict: "cache_key" }
        );
      } catch (err) {
        errors.push(`Google discovery ${discoveryQuery}: ${String(err)}`);
      }
    }

    // Log completion
    if (logId) {
      await supabase
        .from("cron_logs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          books_added: booksAdded,
          errors: errors.length > 0 ? errors : [],
        })
        .eq("id", logId);
    }

    return NextResponse.json({
      status: "completed",
      books_added: booksAdded,
      errors: errors.length,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    // Log failure
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
      { status: "failed", error: String(err), books_added: booksAdded },
      { status: 500 }
    );
  }
}
