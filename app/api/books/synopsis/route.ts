import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { generateSynopsis } from "@/lib/books/ai-synopsis";
import {
  checkRateLimit,
  rateLimitHeaders,
  rateLimitResponse,
} from "@/lib/api/rate-limit";

const RATE_LIMIT_MAX = 12;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

/**
 * On-demand AI synopsis generation.
 * Called from the book detail page when a book has a description but no synopsis.
 * Returns the generated synopsis or a status indicating it was skipped.
 */
export async function POST(req: NextRequest) {
  const rateLimit = await checkRateLimit(req, {
    bucket: "books:synopsis",
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

  const { data: book } = await supabase
    .from("books")
    .select("id, title, author, description, ai_synopsis, is_canon")
    .eq("id", bookId)
    .single();

  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  // Already has a synopsis — return it
  if (book.ai_synopsis) {
    return NextResponse.json(
      { synopsis: book.ai_synopsis },
      { headers: rateLimitHeaders(rateLimit, RATE_LIMIT_MAX) }
    );
  }

  // Need a description to generate from
  if (!book.description || book.description.length < 20) {
    return NextResponse.json(
      { synopsis: null, reason: "no_description" },
      { headers: rateLimitHeaders(rateLimit, RATE_LIMIT_MAX) }
    );
  }

  // Only generate for canon books
  if (book.is_canon === false) {
    return NextResponse.json(
      { synopsis: null, reason: "not_canon" },
      { headers: rateLimitHeaders(rateLimit, RATE_LIMIT_MAX) }
    );
  }

  // Get tropes for better synopsis context
  const { data: tropeRows } = await supabase
    .from("book_tropes")
    .select("tropes(name)")
    .eq("book_id", bookId);

  const tropes = (tropeRows ?? [])
    .map((bt: Record<string, unknown>) =>
      ((bt.tropes as Record<string, unknown>)?.name as string) ?? ""
    )
    .filter(Boolean);

  const synopsis = await generateSynopsis({
    id: book.id,
    title: book.title,
    author: book.author,
    description: book.description,
    aiSynopsis: null,
    tropes,
  });

  if (synopsis) {
    return NextResponse.json(
      { synopsis },
      { headers: rateLimitHeaders(rateLimit, RATE_LIMIT_MAX) }
    );
  }

  return NextResponse.json(
    { synopsis: null, reason: "limit_reached" },
    { headers: rateLimitHeaders(rateLimit, RATE_LIMIT_MAX) }
  );
}
