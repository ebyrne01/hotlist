/**
 * CRON JOB — Open Library Subject Discovery
 *
 * Runs every Wednesday at 4am UTC.
 * Processes ONE subject per invocation, rotating through the subject list.
 *
 * Time budget: 55 seconds (Vercel hobby plan limit).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth, cronUnauthorized } from "@/lib/api/cron-auth";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  OL_SUBJECTS,
  fetchSubjectPage,
  processOLWorks,
} from "@/lib/books/open-library-discovery";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro

const TIME_BUDGET_MS = 240_000;

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request)) {
    return cronUnauthorized();
  }

  const startTime = Date.now();
  const supabase = getAdminClient();

  // Determine which subject + offset to process (rotating counter)
  const { data: counterRow } = await supabase
    .from("homepage_cache")
    .select("book_ids, fetched_at")
    .eq("cache_key", "ol_discovery_counter")
    .single();

  let subjectIndex = 0;
  let offset = 0;

  if (counterRow) {
    // Decode subject index and offset from stored state
    // subject index stored in milliseconds, offset in book_ids length
    const lastRun = new Date(counterRow.fetched_at);
    subjectIndex = lastRun.getMilliseconds() % OL_SUBJECTS.length;
    // book_ids array length encodes the offset (each element = 50 offset increment)
    offset = (counterRow.book_ids?.length ?? 0) * 50;
  }

  const subject = OL_SUBJECTS[subjectIndex];

  try {
    // Fetch one page of works from this subject at the current offset
    const { works, totalCount } = await fetchSubjectPage(subject, 50, offset);

    if (works.length === 0) {
      // Move to next subject, reset offset
      const nextIndex = (subjectIndex + 1) % OL_SUBJECTS.length;
      await saveCounter(supabase, nextIndex, 0);

      return NextResponse.json({
        status: "completed",
        subject,
        offset,
        works_found: 0,
        books_added: 0,
        next_subject: OL_SUBJECTS[nextIndex],
        duration_ms: Date.now() - startTime,
      });
    }

    // Process works within time budget
    const remainingMs = TIME_BUDGET_MS - (Date.now() - startTime);
    const progress = await processOLWorks(works, remainingMs);

    // Advance: if we got a full page and haven't exhausted the subject, increment offset
    let nextSubjectIndex = subjectIndex;
    let nextOffset = offset + 50;

    if (works.length < 50 || nextOffset >= totalCount) {
      // Subject exhausted — move to next, reset offset
      nextSubjectIndex = (subjectIndex + 1) % OL_SUBJECTS.length;
      nextOffset = 0;
    }

    await saveCounter(supabase, nextSubjectIndex, nextOffset);

    // Update last run timestamp
    await supabase.from("homepage_cache").upsert(
      {
        cache_key: "ol_discovery_last_run",
        book_ids: [],
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "cache_key" }
    );

    return NextResponse.json({
      status: "completed",
      subject,
      offset,
      works_found: works.length,
      books_resolved: progress.resolved,
      books_added: progress.added,
      books_skipped: progress.skipped,
      errors: progress.errors,
      next_subject: OL_SUBJECTS[nextSubjectIndex],
      next_offset: nextOffset,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "failed",
        subject,
        offset,
        error: String(err),
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

/** Persist the rotating counter state to homepage_cache. */
async function saveCounter(
  supabase: ReturnType<typeof getAdminClient>,
  subjectIndex: number,
  offset: number
) {
  const timestamp = new Date();
  timestamp.setMilliseconds(subjectIndex);

  // Encode offset as array length (each element = 50)
  const offsetMarkers = Array.from(
    { length: Math.floor(offset / 50) },
    () => "00000000-0000-0000-0000-000000000000"
  );

  await supabase.from("homepage_cache").upsert(
    {
      cache_key: "ol_discovery_counter",
      book_ids: offsetMarkers,
      fetched_at: timestamp.toISOString(),
    },
    { onConflict: "cache_key" }
  );
}
