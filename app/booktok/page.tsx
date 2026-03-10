"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSignInModal } from "@/lib/auth/useSignInModal";
import { createClient } from "@/lib/supabase/client";
import BookCover from "@/components/ui/BookCover";
import RatingBadge from "@/components/ui/RatingBadge";
import type { GrabResult, GrabStatus } from "@/lib/video";
import type { ResolvedBook } from "@/lib/video/book-resolver";

// ── Status messages for processing animation ────────────

const STATUS_MESSAGES: Record<GrabStatus, string> = {
  downloading: "Downloading video...",
  transcribing: "Transcribing audio...",
  scanning: "Scanning for book covers...",
  extracting: "Finding book mentions...",
  correcting: "Double-checking titles...",
  resolving: "Matching to our database...",
  done: "Done!",
};

// ── Sentiment labels ────────────────────────────────────

const SENTIMENT_EMOJI: Record<string, string> = {
  loved: "loved it",
  liked: "liked it",
  mixed: "mixed feelings",
  disliked: "didn't love it",
  neutral: "mentioned",
};

// ── Main Page Component ─────────────────────────────────

export default function BookTokPage() {
  return (
    <Suspense fallback={<div className="max-w-2xl mx-auto px-4 py-16 text-center text-muted font-body">Loading...</div>}>
      <BookTokPageInner />
    </Suspense>
  );
}

function BookTokPageInner() {
  const [url, setUrl] = useState("");
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<GrabStatus | null>(null);
  const [result, setResult] = useState<GrabResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [addingAll, setAddingAll] = useState(false);
  const [addedHotlistSlug, setAddedHotlistSlug] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { user } = useAuth();
  const { openSignIn } = useSignInModal();
  const searchParams = useSearchParams();

  async function handleGrab(overrideUrl?: string) {
    const targetUrl = overrideUrl || url;
    if (!targetUrl.trim()) return;

    setProcessing(true);
    setStatus(null);
    setResult(null);
    setError(null);

    try {
      abortRef.current = new AbortController();

      const response = await fetch("/api/grab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl.trim() }),
        signal: abortRef.current.signal,
      });

      // Non-streaming response (cached result)
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const data = await response.json();
        if (data.error) {
          setError(getErrorMessage(data.error));
        } else {
          setResult(data);
        }
        setProcessing(false);
        return;
      }

      // Streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (!reader) {
        setError("Failed to connect to the server.");
        setProcessing(false);
        return;
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.status) {
              setStatus(parsed.status as GrabStatus);
            }
            if (parsed.result) {
              const grabResult = parsed.result as GrabResult;
              if (grabResult.success) {
                setResult(grabResult);
              } else {
                setError(getErrorMessage(grabResult.error));
                if ("transcript" in grabResult && grabResult.transcript) {
                  setResult(grabResult as unknown as GrabResult);
                }
              }
            }
          } catch {
            // Ignore malformed JSON chunks
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError("Something went wrong. Please try again.");
        console.error("[BookTokPage] fetch error:", err);
      }
    } finally {
      setProcessing(false);
    }
  }

  // Auto-fill + auto-trigger from URL query param (e.g. from search bar redirect)
  useEffect(() => {
    const urlParam = searchParams.get("url");
    if (urlParam && !processing && !result) {
      setUrl(urlParam);
      handleGrab(urlParam);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAddAllToHotlist() {
    if (!user) {
      openSignIn();
      return;
    }
    if (!result || !result.success) return;

    const matchedBooks = result.books.filter(
      (b): b is Extract<ResolvedBook, { matched: true }> => b.matched
    );
    if (matchedBooks.length === 0) return;

    setAddingAll(true);
    try {
      const supabase = createClient();

      // Create a new hotlist named after the creator
      const listName = result.creatorHandle
        ? `${result.creatorHandle} picks`
        : "Video picks";
      const shareSlug =
        listName
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/\s+/g, "-")
          .slice(0, 30) +
        "-" +
        Math.random().toString(36).slice(2, 6);

      const { data: hotlist } = await supabase
        .from("hotlists")
        .insert({
          user_id: user.id,
          name: listName,
          is_public: false,
          share_slug: shareSlug,
        })
        .select("id, share_slug")
        .single();

      if (!hotlist) throw new Error("Failed to create hotlist");

      // Add all matched books
      const bookRows = matchedBooks.map((b, i) => ({
        hotlist_id: hotlist.id,
        book_id: b.book.id,
        position: i,
      }));

      await supabase.from("hotlist_books").insert(bookRows);
      setAddedHotlistSlug(hotlist.share_slug);
    } catch (err) {
      console.error("[handleAddAllToHotlist] failed:", err);
    } finally {
      setAddingAll(false);
    }
  }

  function getErrorMessage(code: string): string {
    switch (code) {
      case "invalid_url":
        return "Please paste a TikTok, Instagram, or YouTube URL.";
      case "video_unavailable":
        return "We couldn't access this video. It may be private or the link may have expired.";
      case "transcription_failed":
        return "We had trouble processing this video's audio. Try a different video.";
      case "no_books_found":
        return "We didn't find any book mentions in this video.";
      default:
        return "Something went wrong. Please try again.";
    }
  }

  const matchedCount =
    result && result.success
      ? result.books.filter((b) => b.matched).length
      : 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      {/* Header */}
      <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink italic">
        {"BookTok \u2192 Hotlist"}
      </h1>
      <p className="text-sm font-body text-muted mt-2 max-w-lg">
        Paste a BookTok, Instagram, or YouTube link and we&apos;ll find every
        book recommendation for you.
      </p>
      <p className="text-xs font-mono text-muted/50 mt-1">
        Works with TikTok, Instagram Reels, and YouTube
      </p>

      {/* Input section */}
      <div className="mt-6 flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a BookTok or video link..."
          className="flex-1 text-sm font-body border border-border rounded-lg px-4 py-3 focus:outline-none focus:border-fire/50 bg-white"
          onKeyDown={(e) => e.key === "Enter" && !processing && handleGrab()}
          disabled={processing}
        />
        <button
          onClick={() => handleGrab()}
          disabled={processing || !url.trim()}
          className="px-5 py-3 bg-fire text-white text-sm font-mono font-medium rounded-lg hover:bg-fire/90 transition-colors disabled:opacity-50 shrink-0"
        >
          {processing ? "Finding..." : "Find Books \u2192"}
        </button>
      </div>

      {/* Platform icons */}
      <div className="flex items-center gap-3 mt-3 text-xs font-mono text-muted/40">
        <span>Supported:</span>
        <span>TikTok</span>
        <span>&middot;</span>
        <span>Instagram</span>
        <span>&middot;</span>
        <span>YouTube</span>
      </div>

      {/* Processing state */}
      {processing && status && (
        <div className="mt-8 text-center py-8">
          <div className="text-3xl mb-3 animate-pulse">🔥</div>
          <p className="text-sm font-mono text-ink font-medium">
            {STATUS_MESSAGES[status]}
          </p>
          <p className="text-xs font-mono text-muted/50 mt-2">
            This usually takes 15-30 seconds
          </p>
        </div>
      )}

      {/* Error state */}
      {error && !processing && (
        <div className="mt-8 p-4 border border-fire/20 rounded-lg bg-white text-center">
          <p className="text-sm font-body text-ink">{error}</p>
          {result && !result.success && "transcript" in result && result.transcript && (
            <button
              onClick={() => setShowTranscript(true)}
              className="mt-2 text-xs font-mono text-fire hover:text-fire/80 transition-colors"
            >
              Show transcript
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {result && result.success && !processing && (
        <div className="mt-8">
          {/* Source video card */}
          <div className="flex items-center gap-3 p-3 bg-white border border-border rounded-lg mb-6">
            {result.thumbnailUrl && (
              <img
                src={result.thumbnailUrl}
                alt="Video thumbnail"
                className="w-16 h-16 rounded object-cover shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              {result.creatorHandle && (
                <p className="text-sm font-mono text-ink font-semibold truncate">
                  {result.creatorHandle}
                </p>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-mono text-muted/60 uppercase">
                  {result.platform}
                </span>
                <span className="text-[10px] font-mono text-fire font-medium">
                  {result.booksFound} book{result.booksFound !== 1 ? "s" : ""}{" "}
                  found
                </span>
              </div>
            </div>
            {result.processingTimeMs > 0 && (
              <span className="text-[10px] font-mono text-muted/40 shrink-0">
                {(result.processingTimeMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>

          {/* Bulk add CTA */}
          {matchedCount > 0 && (
            <div className="mb-6">
              {addedHotlistSlug ? (
                <Link
                  href={`/lists/${addedHotlistSlug}`}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-fire text-white text-sm font-mono font-medium rounded-lg hover:bg-fire/90 transition-colors"
                >
                  {"View Hotlist \u2192"}
                </Link>
              ) : (
                <button
                  onClick={handleAddAllToHotlist}
                  disabled={addingAll}
                  className="px-5 py-2.5 bg-fire text-white text-sm font-mono font-medium rounded-lg hover:bg-fire/90 transition-colors disabled:opacity-50"
                >
                  {addingAll
                    ? "Creating..."
                    : `Add all ${matchedCount} books to a Hotlist`}
                </button>
              )}
            </div>
          )}

          {/* Book cards */}
          <div className="grid gap-3">
            {result.books.map((book, i) =>
              book.matched ? (
                <MatchedBookCard key={i} book={book} />
              ) : (
                <UnmatchedBookCard key={i} book={book} />
              )
            )}
          </div>

          {/* Transcript section */}
          <div className="mt-8 border-t border-border pt-4">
            <button
              onClick={() => setShowTranscript(!showTranscript)}
              className="text-xs font-mono text-muted/60 hover:text-ink transition-colors"
            >
              {showTranscript
                ? "Hide transcript \u25B4"
                : "Show full transcript \u25BE"}
            </button>
            {showTranscript && (
              <div className="mt-3 p-3 bg-white border border-border rounded-lg max-h-60 overflow-y-auto">
                <p className="text-xs font-body text-muted/80 whitespace-pre-wrap leading-relaxed">
                  {result.transcript}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Matched Book Card ───────────────────────────────────

function MatchedBookCard({
  book,
}: {
  book: Extract<ResolvedBook, { matched: true }>;
}) {
  const detail = book.book;
  const grRating = detail.ratings.find((r) => r.source === "goodreads");
  const spice = detail.spice.find(
    (s) =>
      s.source === "romance_io" ||
      s.source === "hotlist_community" ||
      s.source === "goodreads_inference"
  );

  return (
    <div className="flex gap-3 p-3 bg-white border border-border rounded-lg hover:border-fire/20 transition-colors">
      <Link href={`/book/${detail.slug}`} className="shrink-0">
        <BookCover
          title={detail.title}
          coverUrl={detail.coverUrl}
          size="sm"
          className="w-16 h-24 rounded"
        />
      </Link>
      <div className="flex-1 min-w-0">
        <Link href={`/book/${detail.slug}`}>
          <h3 className="font-display font-bold text-ink text-sm truncate hover:text-fire transition-colors">
            {detail.title}
          </h3>
        </Link>
        <p className="text-xs font-body text-muted truncate">
          {detail.author}
          {detail.genres.length > 0 && (
            <> &middot; {detail.genres[0]}</>
          )}
        </p>

        {/* Ratings row */}
        <div className="flex items-center gap-3 mt-1">
          {grRating?.rating && (
            <RatingBadge
              score={grRating.rating}
              source="goodreads"
              ratingCount={grRating.ratingCount}
            />
          )}
          {spice && (
            <span className="text-xs">
              {Array.from({ length: Math.min(5, Math.round(spice.spiceLevel)) }, (_, i) => (
                <span key={i}>🌶️</span>
              ))}
            </span>
          )}
        </div>

        {/* Creator quote */}
        {book.creatorQuote && (
          <p className="mt-1.5 text-xs font-body text-muted/70 italic leading-snug line-clamp-2">
            &ldquo;{book.creatorQuote}&rdquo;
          </p>
        )}
        <p className="text-[10px] font-mono text-muted/40 mt-0.5">
          {SENTIMENT_EMOJI[book.creatorSentiment] ?? "mentioned"}
        </p>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        <Link
          href={`/book/${detail.slug}`}
          className="text-[10px] font-mono text-fire hover:text-fire/80 transition-colors"
        >
          View &rarr;
        </Link>
      </div>
    </div>
  );
}

// ── Unmatched Book Card ─────────────────────────────────

function UnmatchedBookCard({
  book,
}: {
  book: Extract<ResolvedBook, { matched: false }>;
}) {
  return (
    <div className="flex gap-3 p-3 bg-white border border-border rounded-lg opacity-70">
      <div className="w-16 h-24 rounded bg-cream border border-border flex items-center justify-center shrink-0">
        <span className="text-2xl text-muted/30">?</span>
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-display font-bold text-ink text-sm truncate">
          {book.rawTitle}
        </h3>
        {book.rawAuthor && (
          <p className="text-xs font-body text-muted truncate">
            {book.rawAuthor}
          </p>
        )}
        <p className="text-xs font-mono text-muted/50 mt-1">
          Mentioned but not in our database yet
        </p>
        {book.creatorQuote && (
          <p className="mt-1 text-xs font-body text-muted/70 italic leading-snug line-clamp-2">
            &ldquo;{book.creatorQuote}&rdquo;
          </p>
        )}
        <Link
          href={`/search?q=${encodeURIComponent(book.rawTitle + (book.rawAuthor ? " " + book.rawAuthor : ""))}`}
          className="inline-block mt-1.5 text-[10px] font-mono text-fire hover:text-fire/80 transition-colors"
        >
          Search for this book &rarr;
        </Link>
      </div>
    </div>
  );
}
