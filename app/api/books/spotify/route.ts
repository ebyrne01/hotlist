import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { searchBookPlaylists } from "@/lib/spotify/search";

/**
 * POST /api/books/spotify
 * On-demand Spotify playlist lookup. Called from the book detail page
 * when a book has no playlists yet. Fire-and-forget from the client side.
 *
 * Skips if playlists were already fetched (within 7 days).
 */
export async function POST(req: NextRequest) {
  const { bookId, title, author } = (await req.json()) as {
    bookId: string;
    title: string;
    author: string;
  };

  if (!bookId || !title || !author) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Bail early if Spotify credentials aren't configured
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    return NextResponse.json({ status: "not_configured" });
  }

  const supabase = getAdminClient();

  // Check if we already have fresh data (fetched within 7 days)
  const { data: book } = await supabase
    .from("books")
    .select("spotify_playlists, spotify_fetched_at")
    .eq("id", bookId)
    .single();

  if (book?.spotify_fetched_at) {
    const age = Date.now() - new Date(book.spotify_fetched_at).getTime();
    if (age < 7 * 24 * 60 * 60 * 1000) {
      return NextResponse.json({ status: "fresh", playlists: book.spotify_playlists });
    }
  }

  try {
    const playlists = await searchBookPlaylists(title, author);

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
    console.warn(`[spotify] On-demand fetch failed for "${title}":`, msg);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}
