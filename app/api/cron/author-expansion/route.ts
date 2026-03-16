/**
 * CRON JOB — Weekly Author Expansion
 *
 * Runs every Monday at 3am UTC.
 * Finds popular authors (most books saved/in hotlists) whose bibliographies
 * haven't been fully crawled, then runs author_crawl to discover more books.
 *
 * Time budget: 240s (Vercel Pro).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { runAuthorCrawl } from "@/lib/books/author-crawl";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TIME_BUDGET_MS = 240_000;
const MAX_AUTHORS = 10;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const isDev = process.env.NODE_ENV === "development";
  if (!isDev && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const supabase = getAdminClient();

  function timeLeft() {
    return TIME_BUDGET_MS - (Date.now() - startTime);
  }

  try {
    // Find authors with the most books in hotlists (popular with users)
    // who still have books without author_crawled_at set
    const { data: topAuthors } = await supabase.rpc("get_uncrawled_popular_authors", {
      p_limit: MAX_AUTHORS,
    });

    // Fallback: if RPC doesn't exist, query directly
    let authors: { author: string; goodreads_id: string; book_count: number }[] = [];

    if (topAuthors && topAuthors.length > 0) {
      authors = topAuthors;
    } else {
      // Direct query fallback — find authors with goodreads_id books that haven't been crawled
      const { data: fallbackAuthors } = await supabase
        .from("books")
        .select("author, goodreads_id")
        .not("goodreads_id", "is", null)
        .is("author_crawled_at", null)
        .limit(200);

      if (fallbackAuthors) {
        // Group by author, pick one goodreads_id per author, sort by frequency
        const authorMap = new Map<string, { goodreads_id: string; count: number }>();
        for (const row of fallbackAuthors) {
          const existing = authorMap.get(row.author);
          if (existing) {
            existing.count++;
          } else {
            authorMap.set(row.author, { goodreads_id: row.goodreads_id, count: 1 });
          }
        }
        authors = Array.from(authorMap.entries())
          .map(([author, { goodreads_id, count }]) => ({ author, goodreads_id, book_count: count }))
          .sort((a, b) => b.book_count - a.book_count)
          .slice(0, MAX_AUTHORS);
      }
    }

    let crawled = 0;
    const results: { author: string; status: string }[] = [];

    for (const entry of authors) {
      if (timeLeft() < 15_000) break;

      try {
        await runAuthorCrawl(entry.goodreads_id, entry.author);
        crawled++;
        results.push({ author: entry.author, status: "ok" });
      } catch (err) {
        results.push({ author: entry.author, status: String(err).slice(0, 100) });
      }
    }

    return NextResponse.json({
      status: "completed",
      authors_targeted: authors.length,
      authors_crawled: crawled,
      results,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "failed",
        error: String(err),
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
