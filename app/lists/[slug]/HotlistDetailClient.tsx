"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import HotlistTable from "@/components/hotlists/HotlistTable";
import SearchBar, { type SearchResult } from "@/components/search/SearchBar";
import type { HotlistDetail, BookDetail } from "@/lib/types";

interface Props {
  hotlist: HotlistDetail;
  isOwner: boolean;
  currentUserId: string | null;
}

export default function HotlistDetailClient({ hotlist, isOwner, currentUserId }: Props) {
  const router = useRouter();
  const [name, setName] = useState(hotlist.name);
  const [editing, setEditing] = useState(false);
  const [isPublic, setIsPublic] = useState(hotlist.isPublic);
  const [shareSlug] = useState(hotlist.shareSlug);
  const [copied, setCopied] = useState(false);
  const [books, setBooks] = useState(hotlist.books);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Track which books are still being enriched
  const enrichingBookIds = new Set(
    books
      .filter((b) => b.book.enrichmentStatus !== "complete" && b.book.enrichmentStatus !== null)
      .map((b) => b.bookId)
  );
  const hasEnrichingBooks = enrichingBookIds.size > 0;

  // Poll for enrichment updates when books are missing data
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollForUpdates = useCallback(async () => {
    const idsToRefresh = Array.from(enrichingBookIds);
    if (idsToRefresh.length === 0) return;

    try {
      const res = await fetch("/api/books/refresh-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookIds: idsToRefresh }),
      });
      if (!res.ok) return;

      const { books: freshBooks } = await res.json() as {
        books: Record<string, BookDetail>;
      };

      setBooks((prev) =>
        prev.map((b) => {
          const fresh = freshBooks[b.bookId];
          if (!fresh) return b;
          return { ...b, book: fresh };
        })
      );
    } catch {
      // Polling failure is non-fatal — will retry next interval
    }
  }, [enrichingBookIds]);

  useEffect(() => {
    if (!hasEnrichingBooks) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    // Start polling every 8 seconds
    pollRef.current = setInterval(pollForUpdates, 8_000);

    // Also fire one immediate poll after 2s (enrichment may already be done)
    const immediateTimeout = setTimeout(pollForUpdates, 2_000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      clearTimeout(immediateTimeout);
    };
  }, [hasEnrichingBooks, pollForUpdates]);

  async function handleNameSave() {
    if (!name.trim() || name.trim() === hotlist.name) {
      setName(hotlist.name);
      setEditing(false);
      return;
    }
    try {
      const supabase = createClient();
      await supabase
        .from("hotlists")
        .update({ name: name.trim(), updated_at: new Date().toISOString() })
        .eq("id", hotlist.id);
      setEditing(false);
    } catch (err) {
      console.error("[handleNameSave] failed:", err);
      setName(hotlist.name);
      setEditing(false);
    }
  }

  async function handleTogglePublic() {
    const newPublic = !isPublic;
    try {
      const supabase = createClient();

      const updates: Record<string, unknown> = {
        is_public: newPublic,
        updated_at: new Date().toISOString(),
      };

      await supabase.from("hotlists").update(updates).eq("id", hotlist.id);
      setIsPublic(newPublic);

      // Auto-copy link when toggling to public
      if (newPublic) {
        const slug = shareSlug ?? hotlist.id;
        const url = `${window.location.origin}/lists/${slug}`;
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      }
    } catch (err) {
      console.error("[handleTogglePublic] failed:", err);
    }
  }

  async function handleCopyLink() {
    const slug = shareSlug ?? hotlist.id;
    const url = `${window.location.origin}/lists/${slug}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRemoveBook(bookId: string) {
    try {
      const supabase = createClient();
      await supabase
        .from("hotlist_books")
        .delete()
        .eq("hotlist_id", hotlist.id)
        .eq("book_id", bookId);

      setBooks((prev) => prev.filter((b) => b.bookId !== bookId));
    } catch (err) {
      console.error("[handleRemoveBook] failed:", err);
    }
  }

  async function handleRateBook(bookId: string, stars: number) {
    if (!currentUserId) return;
    try {
      const supabase = createClient();

      await supabase.from("user_ratings").upsert(
        {
          user_id: currentUserId,
          book_id: bookId,
          star_rating: stars,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,book_id" }
      );

      setBooks((prev) =>
        prev.map((b) =>
          b.bookId === bookId
            ? { ...b, userRating: { starRating: stars, spiceRating: b.userRating?.spiceRating ?? null, note: b.userRating?.note ?? null } }
            : b
        )
      );
    } catch (err) {
      console.error("[handleRateBook] failed:", err);
    }
  }

  async function handleAddBookFromSearch(searchResult: SearchResult) {
    // Check if book is already in this hotlist
    if (books.some((b) => b.bookId === searchResult.id)) return;

    try {
      const supabase = createClient();
      const nextPosition = books.length + 1;

      // Insert into hotlist_books
      const { data: insertedRow } = await supabase
        .from("hotlist_books")
        .insert({
          hotlist_id: hotlist.id,
          book_id: searchResult.id,
          position: nextPosition,
        })
        .select("id, added_at")
        .single();

      if (!insertedRow) return;

      // Update hotlist timestamp
      await supabase
        .from("hotlists")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", hotlist.id);

      // Create an optimistic HotlistBookDetail entry with what we know
      // Ratings/spice/tropes will be empty until enrichment runs
      const now = new Date().toISOString();
      setBooks((prev) => [
        ...prev,
        {
          id: insertedRow.id,
          bookId: searchResult.id,
          position: nextPosition,
          addedAt: insertedRow.added_at ?? now,
          book: {
            id: searchResult.id,
            isbn: null,
            isbn13: null,
            googleBooksId: null,
            title: searchResult.title,
            author: searchResult.author,
            seriesName: searchResult.seriesName,
            seriesPosition: searchResult.seriesPosition,
            coverUrl: searchResult.coverUrl,
            pageCount: null,
            publishedYear: null,
            publisher: null,
            description: null,
            aiSynopsis: null,
            goodreadsId: searchResult.goodreadsId,
            goodreadsUrl: null,
            amazonAsin: null,
            romanceIoSlug: null,
            romanceIoHeatLabel: null,
            genres: [],
            subgenre: searchResult.subgenre,
            metadataSource: "goodreads",
            slug: searchResult.slug,
            createdAt: now,
            updatedAt: now,
            dataRefreshedAt: null,
            enrichmentStatus: null,
            ratings: [],
            spice: [],
            compositeSpice: null,
            tropes: [],
          },
          userRating: null,
        },
      ]);

      // Trigger background enrichment
      fetch("/api/books/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: searchResult.id,
          title: searchResult.title,
          author: searchResult.author,
        }),
      }).catch(() => {});
    } catch (err) {
      console.error("[handleAddBookFromSearch] failed:", err);
    }
  }

  async function handleDelete() {
    try {
      const supabase = createClient();
      await supabase.from("hotlists").delete().eq("id", hotlist.id);
      router.push("/lists");
    } catch (err) {
      console.error("[handleDelete] failed:", err);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Non-owner banner */}
      {!isOwner && (
        <div className="mb-6 px-4 py-3 bg-cream border border-border rounded-lg flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm font-body text-muted">
            <strong className="text-ink">{hotlist.ownerName ?? "A reader"}&apos;s</strong> Hotlist
          </p>
          <Link
            href="/"
            className="text-xs font-mono text-fire hover:underline"
          >
            Build your own on Hotlist &rarr;
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div className="flex-1 min-w-0">
          {isOwner && editing ? (
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNameSave();
                if (e.key === "Escape") { setName(hotlist.name); setEditing(false); }
              }}
              className="font-display text-2xl font-bold text-ink bg-transparent border-b-2 border-fire/50 focus:outline-none w-full"
              autoFocus
            />
          ) : (
            <h1
              className={`font-display text-2xl font-bold text-ink ${isOwner ? "cursor-pointer hover:text-fire/80 transition-colors" : ""}`}
              onClick={() => {
                if (isOwner) {
                  setEditing(true);
                  setTimeout(() => nameInputRef.current?.focus(), 0);
                }
              }}
              title={isOwner ? "Click to edit name" : undefined}
            >
              {name}
            </h1>
          )}
          <p className="text-xs font-mono text-muted mt-1">
            {hotlist.sourceCreatorHandle && (
              <>
                <Link
                  href={`/discover/${encodeURIComponent(hotlist.sourceCreatorHandle)}`}
                  className="text-fire/70 hover:text-fire transition-colors"
                >
                  {hotlist.sourceCreatorHandle}
                </Link>
                {" · "}
              </>
            )}
            {books.length} {books.length === 1 ? "book" : "books"}
          </p>
        </div>

        {isOwner && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Privacy toggle — clickable badge */}
            <button
              onClick={handleTogglePublic}
              className={`inline-flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-full border transition-all ${
                isPublic
                  ? "text-green-700 bg-green-50 border-green-200 hover:bg-green-100"
                  : "text-muted bg-cream border-border hover:border-fire/30 hover:text-ink"
              }`}
              title={isPublic ? "Click to make private" : "Click to make public & shareable"}
            >
              <span className="text-xs">{isPublic ? "\uD83C\uDF10" : "\uD83D\uDD12"}</span>
              {isPublic
                ? (copied ? "Link copied!" : "Public")
                : "Private \u2014 tap to share"}
            </button>

            {/* Copy link button (only when public, separate from toggle) */}
            {isPublic && !copied && (
              <button
                onClick={handleCopyLink}
                className="inline-flex items-center gap-1 text-xs font-mono px-3 py-1.5 rounded-full border border-fire/20 text-fire hover:bg-fire/5 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="4" width="7" height="7" rx="1" />
                  <path d="M8 4V2.5A1.5 1.5 0 006.5 1H2.5A1.5 1.5 0 001 2.5v4A1.5 1.5 0 002.5 8H4" />
                </svg>
                Copy Link
              </button>
            )}
          </div>
        )}
      </div>

      {/* Enrichment banner */}
      {hasEnrichingBooks && (
        <div className="mb-3 px-4 py-2.5 bg-fire/5 border border-fire/15 rounded-lg flex items-center gap-2.5">
          <span className="inline-block w-2 h-2 rounded-full bg-fire/70 animate-pulse shrink-0" />
          <p className="text-xs font-mono text-fire/80">
            Fetching ratings and spice data for {enrichingBookIds.size}{" "}
            {enrichingBookIds.size === 1 ? "book" : "books"}...
          </p>
        </div>
      )}

      {/* Comparison table */}
      <HotlistTable
        books={books}
        isOwner={isOwner}
        onRemoveBook={isOwner ? handleRemoveBook : undefined}
        onRateBook={isOwner ? handleRateBook : undefined}
        affiliateTag={hotlist.ownerAffiliateTag ?? undefined}
        enrichingBookIds={enrichingBookIds}
      />

      {/* Add more books (owner only) */}
      {isOwner && (
        <div className="mt-8">
          <p className="text-xs font-mono text-muted uppercase tracking-wide mb-2">
            Add another book
          </p>
          <div className="max-w-md">
            <SearchBar variant="navbar" onSelectBook={handleAddBookFromSearch} />
          </div>
        </div>
      )}

      {/* Delete (owner only) */}
      {isOwner && (
        <div className="mt-12 pt-6 border-t border-border">
          {showConfirmDelete ? (
            <div className="flex items-center gap-3">
              <p className="text-sm font-body text-muted">
                Delete &ldquo;{name}&rdquo; permanently?
              </p>
              <button
                onClick={handleDelete}
                className="text-xs font-mono px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
              >
                Yes, delete
              </button>
              <button
                onClick={() => setShowConfirmDelete(false)}
                className="text-xs font-mono text-muted hover:text-ink transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowConfirmDelete(true)}
              className="text-xs font-mono text-muted/70 hover:text-red-600 transition-colors"
            >
              Delete this hotlist
            </button>
          )}
        </div>
      )}
    </div>
  );
}
