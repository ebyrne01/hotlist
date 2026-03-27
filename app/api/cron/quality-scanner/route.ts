import { NextResponse } from "next/server";
import { requireCronAuth, cronUnauthorized } from "@/lib/api/cron-auth";
import Anthropic from "@anthropic-ai/sdk";
import { getAdminClient } from "@/lib/supabase/admin";
import { scanBook, isUnderDailyLimit } from "@/lib/quality/haiku-scanner";

// Process up to this many books per cron run
const BATCH_SIZE = 40;
// 1200ms between books = ~50 books/min, safe for Haiku rate limits
const INTER_BOOK_DELAY_MS = 1200;
// Time budget: Vercel cron functions have a 60s limit
const TIME_BUDGET_MS = 55_000;

export async function GET(request: Request) {
  if (!requireCronAuth(request)) {
    return cronUnauthorized();
  }

  if (!(await isUnderDailyLimit())) {
    return NextResponse.json({ ok: true, message: "Daily limit reached, skipping" });
  }

  const supabase = getAdminClient();
  const startTime = Date.now();

  // Find complete books that haven't been Haiku-scanned yet.
  // A book is "scanned" if it has any quality_flags row from haiku_scanner.
  // Use a NOT EXISTS subquery via raw SQL for efficiency.
  const { data: books, error } = await supabase.rpc("get_unscanned_books_for_quality", {
    p_limit: BATCH_SIZE,
  });

  // Fallback if the RPC doesn't exist
  const booksToScan = books ?? (await getUnscannedBooksFallback(supabase, BATCH_SIZE));

  if (error && !books) {
    // Try fallback
    const fallback = await getUnscannedBooksFallback(supabase, BATCH_SIZE);
    if (fallback.length === 0) {
      return NextResponse.json({ ok: true, message: "No books to scan" });
    }
    return await processBatch(fallback, startTime);
  }

  if (!booksToScan || booksToScan.length === 0) {
    return NextResponse.json({ ok: true, message: "No books to scan" });
  }

  return await processBatch(booksToScan, startTime);
}

async function processBatch(
  books: Array<{ id: string; title: string }>,
  startTime: number
) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  let processed = 0;
  let flagged = 0;

  for (const book of books) {
    if (Date.now() - startTime > TIME_BUDGET_MS) break;

    try {
      const result = await scanBook(client, book.id);
      processed++;
      flagged += result.flagged;
      console.log(`[quality-scanner] ${book.title}: ${result.flagged} flags`);
    } catch (err) {
      console.warn(`[quality-scanner] Failed on "${book.title}":`, err);
    }

    await new Promise((r) => setTimeout(r, INTER_BOOK_DELAY_MS));
  }

  return NextResponse.json({
    ok: true,
    processed,
    flagged,
    durationMs: Date.now() - startTime,
  });
}

async function getUnscannedBooksFallback(
  supabase: ReturnType<typeof getAdminClient>,
  limit: number
): Promise<Array<{ id: string; title: string }>> {
  // Get recently enriched complete books
  const { data: allComplete } = await supabase
    .from("books")
    .select("id, title")
    .eq("enrichment_status", "complete")
    .order("updated_at", { ascending: false })
    .limit(limit * 3);

  if (!allComplete || allComplete.length === 0) return [];

  // Find which ones already have haiku_scanner flags
  const bookIds = allComplete.map((b) => b.id);
  const { data: scanned } = await supabase
    .from("quality_flags")
    .select("book_id")
    .eq("source", "haiku_scanner")
    .in("book_id", bookIds);

  const scannedIds = new Set((scanned ?? []).map((r) => r.book_id));
  return allComplete.filter((b) => !scannedIds.has(b.id)).slice(0, limit);
}
