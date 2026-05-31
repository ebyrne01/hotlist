import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { generateRecommendations } from "@/lib/books/ai-recommendations";
import {
  checkRateLimit,
  rateLimitHeaders,
  rateLimitResponse,
} from "@/lib/api/rate-limit";

const RATE_LIMIT_MAX = 8;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

/**
 * On-demand AI recommendations generation.
 * Fire-and-forget: the current page visit uses trope/author fallback,
 * next visit will have cached AI recommendations.
 */
export async function POST(req: NextRequest) {
  const rateLimit = await checkRateLimit(req, {
    bucket: "books:recommendations",
    limit: RATE_LIMIT_MAX,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit, RATE_LIMIT_MAX);
  }

  const { bookId } = await req.json();

  if (!bookId || typeof bookId !== "string") {
    return NextResponse.json({ error: "bookId required" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Check if recs already exist
  const { count } = await supabase
    .from("book_recommendations")
    .select("*", { count: "exact", head: true })
    .eq("book_id", bookId);

  if (count && count > 0) {
    return NextResponse.json(
      { status: "exists" },
      { headers: rateLimitHeaders(rateLimit, RATE_LIMIT_MAX) }
    );
  }

  const { data: book } = await supabase
    .from("books")
    .select("id, title, author, description, genres, series_name, is_canon")
    .eq("id", bookId)
    .single();

  if (!book || book.is_canon === false) {
    return NextResponse.json(
      { status: "skipped" },
      { headers: rateLimitHeaders(rateLimit, RATE_LIMIT_MAX) }
    );
  }

  // Fetch tropes and spice for context
  const [{ data: tropeRows }, { data: spiceRows }] = await Promise.all([
    supabase
      .from("book_tropes")
      .select("tropes(name)")
      .eq("book_id", bookId),
    supabase
      .from("spice_signals")
      .select("spice_value, confidence")
      .eq("book_id", bookId)
      .in("source", ["community", "romance_io"])
      .order("confidence", { ascending: false })
      .limit(1),
  ]);

  const tropes = (tropeRows
    ?.map((r: Record<string, unknown>) =>
      ((r.tropes as Record<string, unknown>)?.name as string) ?? ""
    )
    .filter(Boolean) ?? []) as string[];
  const spiceLevel = (spiceRows?.[0]?.spice_value as number) ?? null;

  // Generate in the current request (not truly fire-and-forget, but fast enough for Haiku)
  await generateRecommendations({
    id: book.id,
    title: book.title,
    author: book.author,
    description: book.description,
    genres: book.genres ?? [],
    seriesName: book.series_name,
    tropes,
    spiceLevel,
  });

  return NextResponse.json(
    { status: "generated" },
    { headers: rateLimitHeaders(rateLimit, RATE_LIMIT_MAX) }
  );
}
