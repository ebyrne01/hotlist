import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { searchBookPlaylists } from "@/lib/spotify/search";
import { checkOrigin } from "@/lib/api/cors";

/**
 * POST /api/books/spotify
 * On-demand Spotify playlist lookup. Called from the book detail page
 * when a book has no playlists yet. Fire-and-forget from the client side.
 *
 * Skips if playlists were already fetched (within 7 days).
 */
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: "Unauthorized origin" }, { status: 403 });
  }

  let bookId: string | null = null;
  try {
    const body = await req.json();
    bookId = typeof body?.bookId === "string" ? body.bookId : null;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!bookId) {
    return NextResponse.json({ error: "Missing bookId" }, { status: 400 });
  }

  // Bail early if Spotify credentials aren't configured
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    return NextResponse.json({ status: "not_configured" });
  }

  const supabase = getAdminClient();

  // Check if we already have fresh data (fetched within 7 days)
  const { data: book } = await supabase
    .from("books")
    .select("title, author, spotify_playlists, spotify_fetched_at")
    .eq("id", bookId)
    .single();

  if (!book?.title || !book.author) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  if (book?.spotify_fetched_at) {
    const age = Date.now() - new Date(book.spotify_fetched_at).getTime();
    if (age < 7 * 24 * 60 * 60 * 1000) {
      return NextResponse.json({ status: "fresh", playlists: book.spotify_playlists });
    }
  }

  try {
    const playlists = await searchBookPlaylists(book.title, book.author);

    await supabase
      .from("books")
      .update({
        spotify_playlists: playlists.length > 0 ? playlists : null,
        spotify_fetched_at: new Date().toISOString(),
      })
      .eq("id", bookId);

    return NextResponse.json({ status: "fetched", playlists: playlists.length > 0 ? playlists : null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Rate limit — don't retry aggressively
    if (msg.includes("rate limit")) {
      return NextResponse.json({ status: "rate_limited" }, { status: 429 });
    }
    console.warn(`[spotify] On-demand fetch failed for "${book.title}":`, msg);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}
