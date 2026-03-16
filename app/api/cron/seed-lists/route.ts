/**
 * CRON JOB — Seed from Goodreads Lists
 *
 * Runs every Sunday at 6am UTC.
 * Processes ONE list per invocation, rotating through the list URLs.
 *
 * Time budget: 55 seconds (Vercel hobby plan limit).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  SEED_LIST_URLS,
  crawlList,
  processListEntries,
} from "@/lib/books/list-crawler";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro

const TIME_BUDGET_MS = 240_000;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const isDev = process.env.NODE_ENV === "development";
  if (!isDev && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const supabase = getAdminClient();

  // Determine which list to process (rotating counter)
  const { data: counterRow } = await supabase
    .from("homepage_cache")
    .select("book_ids, fetched_at")
    .eq("cache_key", "seed_lists_counter")
    .single();

  // The counter is stored as the first element of book_ids (as a string hack)
  // since homepage_cache only has book_ids (uuid[]) and fetched_at
  let listIndex = 0;
  if (counterRow) {
    // Use fetched_at to track the index — store index in a predictable way
    // Parse the last index from the timestamp's milliseconds
    const lastRun = new Date(counterRow.fetched_at);
    listIndex = (lastRun.getMilliseconds() + 1) % SEED_LIST_URLS.length;
  }

  const listUrl = SEED_LIST_URLS[listIndex];
  const listName = listUrl.split("/").pop()?.replace(/_/g, " ") ?? "unknown";

  try {
    // Crawl the list (up to 3 pages)
    const entries = await crawlList(listUrl, 3);

    if (entries.length === 0) {
      return NextResponse.json({
        status: "completed",
        list: listName,
        list_index: listIndex,
        books_found: 0,
        books_added: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    // Process entries within time budget
    const remainingMs = TIME_BUDGET_MS - (Date.now() - startTime);
    const progress = await processListEntries(entries, remainingMs);

    // Update the counter for next run — encode index in a timestamp
    const nextTimestamp = new Date();
    // Store current index in milliseconds for next run to read
    nextTimestamp.setMilliseconds(listIndex);
    await supabase.from("homepage_cache").upsert(
      {
        cache_key: "seed_lists_counter",
        book_ids: [],
        fetched_at: nextTimestamp.toISOString(),
      },
      { onConflict: "cache_key" }
    );

    // Also update last run timestamp
    await supabase.from("homepage_cache").upsert(
      {
        cache_key: "seed_lists_last_run",
        book_ids: [],
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "cache_key" }
    );

    return NextResponse.json({
      status: "completed",
      list: listName,
      list_index: listIndex,
      next_list_index: (listIndex + 1) % SEED_LIST_URLS.length,
      books_found: entries.length,
      books_added: progress.added,
      books_skipped: progress.skipped,
      errors: progress.errors,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "failed",
        list: listName,
        error: String(err),
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
