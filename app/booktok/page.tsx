"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSignInModal } from "@/lib/auth/useSignInModal";
import { createClient } from "@/lib/supabase/client";
import BookCover from "@/components/ui/BookCover";
import GrabFeedbackButton from "@/components/booktok/GrabFeedbackButton";
import MissingBookFeedback from "@/components/booktok/MissingBookFeedback";
import type { GrabResult, GrabStatus } from "@/lib/video";
import type { ResolvedBook } from "@/lib/video/book-resolver";

// ── Status messages for processing animation ────────────

const STATUS_MESSAGES: Record<GrabStatus, string> = {
  downloading: "Downloading video...",
  transcribing: "Transcribing audio...",
  scanning: "Scanning for book covers...",
  extracting: "Finding book mentions...",
  identifying: "Identifying books & confirming editions...",
  done: "Done!",
};

const PROGRESS_STEPS: GrabStatus[] = [
  "downloading",
  "transcribing",
  "scanning",
  "extracting",
  "identifying",
];

const PROGRESS_LABELS: Record<GrabStatus, string> = {
  downloading: "Download",
  transcribing: "Transcribe",
  scanning: "Scan",
  extracting: "Extract",
  identifying: "Identify",
  done: "Done",
};

// ── Sentiment labels ────────────────────────────────────

const SENTIMENT_EMOJI: Record<string, string> = {
  loved: "loved it",
  liked: "liked it",
  mixed: "mixed feelings",
  disliked: "didn't love it",
  neutral: "mentioned",
};

/**
 * Detect whether creator quotes are per-book (unique) or list-level (repeated).
 * When >60% of quotes are identical, it's a list-level theme — show once as a summary.
 */
function extractListQuote(books: ResolvedBook[]): string | null {
  const quotes = books
    .filter((b): b is ResolvedBook & { matched: true } => b.matched && !!b.creatorQuote)
    .map((b) => b.creatorQuote.trim().toLowerCase());

  if (quotes.length < 2) return null;

  // Find the most common quote
  const counts = new Map<string, number>();
  for (const q of quotes) {
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  const [topQuote, topCount] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];

  // If >60% of books share the same quote, it's list-level
  if (topCount / quotes.length > 0.6) {
    // Return the original-case version
    const original = books.find(
      (b) => b.matched && b.creatorQuote?.trim().toLowerCase() === topQuote
    );
    return original && "creatorQuote" in original ? original.creatorQuote : null;
  }
  return null;
}

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
  const [takingLong, setTakingLong] = useState(false);
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
    setTakingLong(false);

    // Update browser URL so auth redirects and bookmarks preserve the video URL
    const urlParam = new URLSearchParams(window.location.search).get("url");
    if (!urlParam) {
      window.history.replaceState({}, "", `/booktok?url=${encodeURIComponent(targetUrl.trim())}`);
    }

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

  useEffect(() => {
    if (!processing) {
      setTakingLong(false);
      return;
    }
    const timeout = setTimeout(() => setTakingLong(true), 45_000);
    return () => clearTimeout(timeout);
  }, [processing]);

  async function handleAddAllToHotlist() {
    const supabase = createClient();
    const activeUser = user ?? (await supabase.auth.getUser()).data.user;
    if (!activeUser) {
      openSignIn(() => {
        void handleAddAllToHotlist();
      }, {
        title: "Save this video list as a Hotlist.",
        subtitle: "Sign in free, then we will create the comparison table.",
        note: "The books we found will stay on this page while you sign in.",
      });
      return;
    }
    if (!result || !result.success) return;

    const matchedBooks = result.books.filter(
      (b): b is Extract<ResolvedBook, { matched: true }> => b.matched
    );
    if (matchedBooks.length === 0) return;

    setAddingAll(true);
    try {
      // Check if this user is a verified creator (auto-public mode)
      const { data: creatorProfile } = await supabase
        .from("profiles")
        .select("is_creator, vanity_slug")
        .eq("id", activeUser.id)
        .single();

      const isCreator = creatorProfile?.is_creator === true;

      // Use the video title/caption as the hotlist name, falling back to creator handle
      // Strip hashtags and trim — TikTok captions often end with #booktok #romancebooks etc.
      const cleanTitle = result.videoTitle
        ?.replace(/#\S+/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100) || null;
      const listName = cleanTitle
        ? cleanTitle
        : result.creatorHandle
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
          user_id: activeUser.id,
          name: listName,
          is_public: isCreator, // Auto-public for verified creators
          share_slug: shareSlug,
          source_creator_handle: result.creatorHandle || null,
          source_video_url: url || null,
          source_video_thumbnail: result.thumbnailUrl || null,
          source_platform: result.platform || null,
        })
        .select("id, share_slug")
        .single();

      if (!hotlist) throw new Error("Failed to create hotlist");

      // Add all matched books — verify each book still exists in DB first
      // (cached grabs may reference books that were deleted/recreated)
      const bookIds = matchedBooks.map((b) => b.book.id);
      const { data: existingBooks } = await supabase
        .from("books")
        .select("id")
        .in("id", bookIds);
      const validIds = new Set((existingBooks ?? []).map((b) => b.id));

      const bookRows = matchedBooks
        .filter((b) => validIds.has(b.book.id))
        .map((b, i) => ({
          hotlist_id: hotlist.id,
          book_id: b.book.id,
          position: i,
        }));

      if (bookRows.length > 0) {
        const { error: insertErr } = await supabase
          .from("hotlist_books")
          .insert(bookRows);
        if (insertErr) {
          console.error("[handleAddAllToHotlist] book insert failed:", insertErr);
        }
      }
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
    <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12">
      {/* Header */}
      <section className="surface-parchment -mx-4 -mt-8 border-b border-aged-gold/30 px-4 py-10 sm:mx-0 sm:mt-0 sm:rounded-3xl sm:border sm:px-8 sm:py-12">
        <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-fire">
              BookTok to Hotlist
            </p>
            <h1 className="mt-2 font-display text-4xl font-bold leading-tight text-ink sm:text-5xl">
              Turn a video rec list into a comparison table.
            </h1>
            <p className="mt-4 max-w-xl text-base font-body leading-7 text-muted-a11y">
              Paste a TikTok, Instagram Reel, or YouTube link. Hotlist finds the
              books, confirms editions, and lets you compare ratings, spice, and
              tropes side by side.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {["TikTok", "Instagram", "YouTube"].map((platform) => (
                <span
                  key={platform}
                  className="rounded-full border border-aged-gold/40 bg-white/70 px-3 py-1.5 text-xs font-mono text-muted-a11y"
                >
                  {platform}
                </span>
              ))}
            </div>
          </div>

          {/* Input section */}
          <div className="rounded-2xl border border-aged-gold/30 bg-white p-4 shadow-sm sm:p-5">
            <label
              htmlFor="booktok-url"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-a11y"
            >
              Video link
            </label>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                id="booktok-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste a BookTok or video link..."
                className="min-h-[48px] w-full rounded-lg border border-border bg-cream px-4 py-3 text-sm font-body text-ink placeholder:text-muted/60 focus:border-fire/50 focus:outline-none focus:ring-2 focus:ring-fire/20"
                onKeyDown={(e) => e.key === "Enter" && !processing && handleGrab()}
                disabled={processing}
              />
              <button
                onClick={() => handleGrab()}
                disabled={processing || !url.trim()}
                className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-fire px-5 py-3 text-sm font-mono font-medium text-white transition-colors hover:bg-fire/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fire disabled:opacity-50"
              >
                {processing ? "Finding..." : "Find books"}
              </button>
            </div>
            <p className="mt-3 text-xs font-body leading-5 text-muted-a11y">
              Works for videos and TikTok photo/carousel posts. Private or
              expired links may not be available.
            </p>
          </div>
        </div>
      </section>

      {/* Processing state */}
      {processing && status && (
        <div className="mt-8 rounded-2xl border border-aged-gold/30 bg-white px-4 py-8 shadow-sm">
          <p className="text-sm font-mono text-ink font-medium text-center">
            {STATUS_MESSAGES[status]}
          </p>
          <p className="text-xs font-body text-muted/70 mt-1 text-center italic">
            Extracting the magic — this usually takes about a minute
          </p>
          {takingLong && (
            <div className="mx-auto mt-4 max-w-md rounded-xl border border-aged-gold/30 bg-cream px-4 py-3 text-center">
              <p className="text-sm font-body leading-6 text-muted-a11y">
                Still working. Longer videos, carousels, and crowded rec lists can take extra time.
              </p>
              <button
                onClick={() => {
                  abortRef.current?.abort();
                  setProcessing(false);
                  setError("We stopped this grab. You can try again, or paste a different link.");
                }}
                className="mt-2 inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-mono uppercase tracking-[0.14em] text-fire transition-colors hover:bg-fire/5"
              >
                Stop and try again
              </button>
            </div>
          )}

          {/* Progress steps */}
          <div className="mt-6 flex items-center justify-center gap-1 max-w-sm mx-auto">
            {PROGRESS_STEPS.map((step, i) => {
              const currentIdx = PROGRESS_STEPS.indexOf(status);
              const isComplete = i < currentIdx;
              const isActive = i === currentIdx;
              return (
                <div key={step} className="flex-1 flex flex-col items-center gap-1.5">
                  <div
                    className={`h-1.5 w-full rounded-full transition-all duration-500 ${
                      isComplete
                        ? "bg-fire"
                        : isActive
                          ? "bg-fire/60 animate-pulse"
                          : "bg-border/40"
                    }`}
                  />
                  <span
                    className={`text-xs font-mono transition-colors duration-300 ${
                      isComplete
                        ? "text-fire/70"
                        : isActive
                          ? "text-ink/70"
                          : "text-muted/70"
                    }`}
                  >
                    {PROGRESS_LABELS[step]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !processing && (
        <div className="mt-8 rounded-2xl border border-fire/20 bg-white p-5 text-center shadow-sm">
          <p className="font-display text-xl font-bold text-ink">
            We could not finish that grab.
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm font-body leading-6 text-muted-a11y">
            {error}
          </p>
          <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
            <button
              onClick={() => handleGrab()}
              disabled={!url.trim()}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-fire px-4 py-2 text-sm font-mono text-white transition-colors hover:bg-fire/90 disabled:opacity-50"
            >
              Try again
            </button>
            <Link
              href="/search"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-aged-gold/30 bg-cream px-4 py-2 text-sm font-mono text-muted-a11y transition-colors hover:border-fire/30 hover:text-fire"
            >
              Search manually
            </Link>
          </div>
          {result && !result.success && "transcript" in result && result.transcript && (
            <button
              onClick={() => setShowTranscript(true)}
              className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-fire/25 bg-fire/5 px-4 py-2 text-xs font-mono uppercase tracking-[0.14em] text-fire transition-colors hover:bg-fire/10"
            >
              Show transcript
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {result && result.success && !processing && (() => {
        const listQuote = extractListQuote(result.books);
        return (
        <div className="mt-8">
          {/* Source video card */}
          <div className="mb-4 flex items-center gap-3 rounded-2xl border border-aged-gold/30 bg-white p-3 shadow-sm">
            {result.thumbnailUrl && (
              <Image
                src={result.thumbnailUrl}
                alt="Video thumbnail"
                width={64}
                height={64}
                unoptimized
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
                <span className="text-xs font-mono text-muted/70 uppercase">
                  {result.platform}
                </span>
                <span className="text-xs font-mono text-fire font-medium">
                  {matchedCount} book{matchedCount !== 1 ? "s" : ""}{" "}
                  found
                </span>
              </div>
              {result.videoTitle && (() => {
                const cleanTitle = result.videoTitle
                  .replace(/#\S+/g, "")
                  .replace(/\s+/g, " ")
                  .trim();
                return cleanTitle ? (
                  <p className="mt-1 text-xs font-body text-muted/70 italic leading-snug line-clamp-2">
                    &ldquo;{cleanTitle}&rdquo;
                  </p>
                ) : null;
              })()}
              {listQuote && (
                <p className="mt-1.5 text-xs font-body text-muted/70 italic leading-snug line-clamp-2">
                  &ldquo;{listQuote}&rdquo;
                </p>
              )}
            </div>
            {result.processingTimeMs > 0 && (
              <span className="text-xs font-mono text-muted/70 shrink-0">
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
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-lg bg-fire px-5 py-2.5 text-sm font-mono font-medium text-white transition-colors hover:bg-fire/90"
                >
                  {"View Hotlist — see ratings & spice \u2192"}
                </Link>
              ) : (
                <>
                  <button
                    onClick={handleAddAllToHotlist}
                    disabled={addingAll}
                    className="min-h-[48px] rounded-lg bg-fire px-5 py-2.5 text-sm font-mono font-medium text-white transition-colors hover:bg-fire/90 disabled:opacity-50"
                  >
                    {addingAll
                      ? "Creating..."
                      : `Add all ${matchedCount} to a Hotlist`}
                  </button>
                  <p className="mt-1.5 text-xs font-mono text-muted/60">
                    Compare ratings, spice levels & tropes side by side
                  </p>
                </>
              )}
            </div>
          )}

          {/* Book cards */}
          <div className="grid gap-3">
            {result.books.map((book, i) =>
              book.matched ? (
                <MatchedBookCard key={i} book={book} videoUrl={url} suppressQuote={!!listQuote} />
              ) : (
                <UnmatchedBookCard key={i} book={book} videoUrl={url} />
              )
            )}
          </div>

          {/* Missing book feedback */}
          <MissingBookFeedback videoUrl={url} />

          {/* Transcript section */}
          <div className="mt-8 border-t border-border pt-4">
            <button
              onClick={() => setShowTranscript(!showTranscript)}
              className="inline-flex min-h-11 items-center text-xs font-mono text-muted-a11y hover:text-ink transition-colors"
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
        );
      })()}
    </div>
  );
}

// ── Matched Book Card ───────────────────────────────────

function MatchedBookCard({
  book,
  videoUrl,
  suppressQuote,
}: {
  book: Extract<ResolvedBook, { matched: true }>;
  videoUrl: string;
  suppressQuote?: boolean;
}) {
  const detail = book.book;

  // Show per-book quote only when it's unique (not a repeated list-level quote)
  const showQuote = !suppressQuote && !!book.creatorQuote;

  return (
    <div className="bg-white border border-border rounded-lg hover:border-fire/20 transition-colors">
      <div className="flex gap-3 p-3">
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
            {detail.seriesName && (
              <> &middot; {detail.seriesName}{detail.seriesPosition ? ` #${detail.seriesPosition}` : ""}</>
            )}
          </p>

          {/* Creator quote (only when unique per book) */}
          {showQuote && (
            <p className="mt-1.5 text-xs font-body text-muted/70 italic leading-snug line-clamp-2">
              &ldquo;{book.creatorQuote}&rdquo;
            </p>
          )}
          <p className="text-xs font-mono text-muted/50 mt-0.5">
            {SENTIMENT_EMOJI[book.creatorSentiment] ?? "mentioned"}
          </p>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <Link
            href={`/book/${detail.slug}`}
            className="text-xs font-mono text-fire hover:text-fire/80 transition-colors"
          >
            View &rarr;
          </Link>
        </div>
      </div>
      <div className="px-3 pb-2">
        <GrabFeedbackButton
          videoUrl={videoUrl}
          bookId={detail.id}
          bookTitle={detail.title}
          feedbackOptions={["wrong_book", "wrong_edition"]}
        />
      </div>
    </div>
  );
}

// ── Unmatched Book Card ─────────────────────────────────

function UnmatchedBookCard({
  book,
  videoUrl,
}: {
  book: Extract<ResolvedBook, { matched: false }>;
  videoUrl: string;
}) {
  return (
    <div className="bg-white border border-border rounded-lg opacity-70">
      <div className="flex gap-3 p-3">
        <div className="w-16 h-24 rounded bg-cream border border-border flex items-center justify-center shrink-0">
          <span className="text-2xl text-muted/70">?</span>
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
          <p className="text-xs font-mono text-muted/70 mt-1">
            Mentioned but not in our database yet
          </p>
          {book.creatorQuote && (
            <p className="mt-1 text-xs font-body text-muted/70 italic leading-snug line-clamp-2">
              &ldquo;{book.creatorQuote}&rdquo;
            </p>
          )}
          <Link
            href={`/search?q=${encodeURIComponent(book.rawTitle + (book.rawAuthor ? " " + book.rawAuthor : ""))}`}
            className="inline-block mt-1.5 text-xs font-mono text-fire hover:text-fire/80 transition-colors"
          >
            Search for this book &rarr;
          </Link>
        </div>
      </div>
      <div className="px-3 pb-2">
        <GrabFeedbackButton
          videoUrl={videoUrl}
          bookTitle={book.rawTitle}
          feedbackOptions={["wrong_book"]}
        />
      </div>
    </div>
  );
}
