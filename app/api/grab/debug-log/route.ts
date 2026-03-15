/**
 * GET /api/grab/debug-log?url=VIDEO_URL
 *
 * Fetches the agent debug log for a given video URL from the
 * agent_debug_logs table. Returns the raw log entries plus a
 * structured summary of searches, confirmations, and submissions.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url param required" }, { status: 400 });
  }

  const supabase = getAdminClient();
  const { data } = await supabase
    .from("agent_debug_logs")
    .select("*")
    .eq("url", url)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!data) {
    return NextResponse.json(
      { error: "No debug log found for this URL" },
      { status: 404 }
    );
  }

  const entries = (data.log_entries as string[]) ?? [];

  return NextResponse.json({
    url: data.url,
    createdAt: data.created_at,
    logEntries: entries,
    summary: parseAgentLogSummary(entries),
  });
}

/**
 * Parse flat log entries into a structured summary.
 * Agent logs follow patterns like:
 *   search_goodreads("Fourth Wing Rebecca Yarros")
 *   search_goodreads("...") => 3 results: Title (ID), ...
 *   confirm_book(12345) => "Title" by Author (series: X #1)
 *   submit_books(5): [{title, author, gid}]
 */
function parseAgentLogSummary(entries: string[]) {
  const searches: Array<{
    query: string;
    resultCount: number;
    results: string[];
  }> = [];
  const confirmations: Array<{
    goodreadsId: string;
    title: string;
    author: string;
  }> = [];
  const submitted: Array<{
    title: string;
    author: string;
    goodreadsId: string | null;
  }> = [];
  let turns = 0;
  let totalMs = 0;

  for (const entry of entries) {
    // Count turns
    const turnMatch = entry.match(/Turn (\d+):/);
    if (turnMatch) turns = Math.max(turns, parseInt(turnMatch[1]));

    // Parse search results
    const searchMatch = entry.match(
      /search_goodreads\("(.+?)"\) => (\d+) results?: (.+)/
    );
    if (searchMatch) {
      searches.push({
        query: searchMatch[1],
        resultCount: parseInt(searchMatch[2]),
        results: searchMatch[3].split(", ").slice(0, 5),
      });
    }

    // Parse confirmations
    const confirmMatch = entry.match(
      /confirm_book\((\d+)\) => "(.+?)" by (.+?) \(/
    );
    if (confirmMatch) {
      confirmations.push({
        goodreadsId: confirmMatch[1],
        title: confirmMatch[2],
        author: confirmMatch[3],
      });
    }

    // Parse submission
    const submitMatch = entry.match(/submit_books\((\d+)\): (.+)/);
    if (submitMatch) {
      try {
        const books = JSON.parse(submitMatch[2]);
        for (const b of books) {
          submitted.push({
            title: b.title,
            author: b.author,
            goodreadsId: b.gid ?? null,
          });
        }
      } catch {
        // ignore parse errors
      }
    }

    // Parse total time
    const timeMatch = entry.match(
      /Agent complete: \d+ turns, (\d+)ms total/
    );
    if (timeMatch) totalMs = parseInt(timeMatch[1]);
  }

  return { turns, totalMs, searches, confirmations, submitted };
}
