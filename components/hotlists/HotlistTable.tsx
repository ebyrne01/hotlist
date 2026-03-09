"use client";

import { useState } from "react";
import Link from "next/link";
import BookCover from "@/components/ui/BookCover";
import type { HotlistBookDetail, Rating } from "@/lib/types";

interface HotlistTableProps {
  books: HotlistBookDetail[];
  isOwner: boolean;
  onRemoveBook?: (bookId: string) => void;
  onRateBook?: (bookId: string, stars: number) => void;
  affiliateTag?: string;
  /** Book IDs currently being enriched in the background */
  enrichingBookIds?: Set<string>;
}

type SortKey = "goodreads" | "amazon" | "romance_io" | "spice" | "pages";
type SortDir = "asc" | "desc";

function getRating(ratings: Rating[], source: string): number | null {
  const r = ratings.find((r) => r.source === source);
  return r?.rating ?? null;
}

function getSpiceLevel(book: HotlistBookDetail): number {
  if (book.book.spice.length === 0) return 0;
  const community = book.book.spice.find((s) => s.source === "hotlist_community");
  if (community) return community.spiceLevel;
  return book.book.spice[0].spiceLevel;
}

/** Build an Amazon search URL as fallback when we don't have an ASIN */
function amazonSearchUrl(title: string, author: string, tag: string): string {
  const query = encodeURIComponent(`${title} ${author}`);
  return `https://www.amazon.com/s?k=${query}${tag ? `&tag=${tag}` : ""}`;
}

/** Check if a book has any ratings data at all */
function hasAnyRatings(hb: HotlistBookDetail): boolean {
  return hb.book.ratings.some((r) => r.rating !== null);
}

export default function HotlistTable({
  books,
  isOwner,
  onRemoveBook,
  onRateBook,
  affiliateTag,
  enrichingBookIds = new Set(),
}: HotlistTableProps) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sortedBooks = [...books].sort((a, b) => {
    if (!sortKey) return a.position - b.position;

    let aVal: number | null = null;
    let bVal: number | null = null;

    switch (sortKey) {
      case "goodreads":
        aVal = getRating(a.book.ratings, "goodreads");
        bVal = getRating(b.book.ratings, "goodreads");
        break;
      case "amazon":
        aVal = getRating(a.book.ratings, "amazon");
        bVal = getRating(b.book.ratings, "amazon");
        break;
      case "romance_io":
        aVal = getRating(a.book.ratings, "romance_io");
        bVal = getRating(b.book.ratings, "romance_io");
        break;
      case "spice":
        aVal = getSpiceLevel(a);
        bVal = getSpiceLevel(b);
        break;
      case "pages":
        aVal = a.book.pageCount;
        bVal = b.book.pageCount;
        break;
    }

    // Nulls sort last
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;

    return sortDir === "asc" ? aVal - bVal : bVal - aVal;
  });

  if (books.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed border-border rounded-lg">
        <p className="font-body text-muted text-sm">
          Add at least 2 books to compare them
        </p>
      </div>
    );
  }

  const tag = affiliateTag ?? process.env.NEXT_PUBLIC_AMAZON_AFFILIATE_TAG ?? "";

  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="w-full min-w-[700px] text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-3 py-2 font-mono text-xs text-muted uppercase tracking-wide sticky left-0 bg-cream z-10">
              Book
            </th>
            <SortHeader label="Goodreads" sortKey="goodreads" currentKey={sortKey} dir={sortDir} onClick={handleSort} />
            <SortHeader label="Amazon" sortKey="amazon" currentKey={sortKey} dir={sortDir} onClick={handleSort} />
            <SortHeader label="romance.io" sortKey="romance_io" currentKey={sortKey} dir={sortDir} onClick={handleSort} />
            <SortHeader label="Spice" sortKey="spice" currentKey={sortKey} dir={sortDir} onClick={handleSort} />
            <th className="text-center px-3 py-2 font-mono text-xs text-muted uppercase tracking-wide">
              My Rating
            </th>
            <th className="text-left px-3 py-2 font-mono text-xs text-muted uppercase tracking-wide">
              Tropes
            </th>
            <SortHeader label="Pages" sortKey="pages" currentKey={sortKey} dir={sortDir} onClick={handleSort} />
            <th className="text-center px-3 py-2 font-mono text-xs text-muted uppercase tracking-wide">
              Buy
            </th>
            {isOwner && (
              <th className="w-10 px-2 py-2" />
            )}
          </tr>
        </thead>
        <tbody>
          {sortedBooks.map((hb) => {
            const gr = getRating(hb.book.ratings, "goodreads");
            const amz = getRating(hb.book.ratings, "amazon");
            const rio = getRating(hb.book.ratings, "romance_io");
            const spice = getSpiceLevel(hb);
            const slug = hb.book.slug || hb.book.id;
            const asin = hb.book.amazonAsin;
            const isEnriching = enrichingBookIds.has(hb.bookId);
            const noRatings = !hasAnyRatings(hb);

            return (
              <tr key={hb.id} className="border-b border-border/50 hover:bg-white/60 transition-colors">
                {/* Book info — sticky on mobile */}
                <td className="px-3 py-3 sticky left-0 bg-cream/95 z-10">
                  <Link href={`/book/${slug}`} className="flex items-center gap-3 group">
                    <BookCover
                      title={hb.book.title}
                      coverUrl={hb.book.coverUrl}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="font-display font-bold text-ink text-sm leading-tight group-hover:text-fire transition-colors truncate max-w-[180px]">
                        {hb.book.title}
                      </p>
                      <p className="text-xs font-body text-muted truncate max-w-[180px]">
                        {hb.book.author}
                      </p>
                    </div>
                  </Link>
                </td>

                {/* Goodreads */}
                <td className="px-3 py-3 text-center font-mono text-sm">
                  <RatingCell value={gr} isEnriching={isEnriching && noRatings} />
                </td>

                {/* Amazon */}
                <td className="px-3 py-3 text-center font-mono text-sm">
                  <RatingCell value={amz} isEnriching={isEnriching && noRatings} />
                </td>

                {/* romance.io */}
                <td className="px-3 py-3 text-center font-mono text-sm">
                  <RatingCell value={rio} isEnriching={isEnriching && noRatings} />
                </td>

                {/* Spice */}
                <td className="px-3 py-3 text-center">
                  {spice > 0 ? (
                    <span className="text-sm" title={`${spice}/5 spice`}>
                      {"🌶️".repeat(spice)}
                    </span>
                  ) : (
                    <span className="text-muted/40 font-mono text-sm">{"\u2014"}</span>
                  )}
                </td>

                {/* My Rating */}
                <td className="px-3 py-3 text-center">
                  <InlineStarRating
                    bookId={hb.bookId}
                    currentRating={hb.userRating?.starRating ?? null}
                    isOwner={isOwner}
                    onRate={onRateBook}
                  />
                </td>

                {/* Tropes */}
                <td className="px-3 py-3">
                  <div className="flex gap-1 flex-wrap max-w-[160px]">
                    {hb.book.tropes.slice(0, 3).map((t) => (
                      <span
                        key={t.id}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded-full border border-border bg-white text-muted whitespace-nowrap"
                      >
                        {t.name}
                      </span>
                    ))}
                    {hb.book.tropes.length === 0 && (
                      <span className="text-muted/40 font-mono text-xs">{"\u2014"}</span>
                    )}
                  </div>
                </td>

                {/* Pages */}
                <td className="px-3 py-3 text-center font-mono text-sm">
                  <span className={hb.book.pageCount ? "text-ink" : "text-muted/40"}>
                    {hb.book.pageCount ?? "\u2014"}
                  </span>
                </td>

                {/* Buy */}
                <td className="px-3 py-3 text-center">
                  {asin ? (
                    <a
                      href={`https://www.amazon.com/dp/${asin}?tag=${tag}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-mono text-fire hover:underline whitespace-nowrap"
                    >
                      Buy &rarr;
                    </a>
                  ) : (
                    <a
                      href={amazonSearchUrl(hb.book.title, hb.book.author, tag)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-mono text-muted hover:text-fire hover:underline whitespace-nowrap transition-colors"
                    >
                      Find &rarr;
                    </a>
                  )}
                </td>

                {/* Remove */}
                {isOwner && (
                  <td className="px-2 py-3 text-center">
                    <button
                      onClick={() => onRemoveBook?.(hb.bookId)}
                      className="text-muted/40 hover:text-fire transition-colors p-1"
                      title="Remove from list"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="3" y1="3" x2="11" y2="11" />
                        <line x1="11" y1="3" x2="3" y2="11" />
                      </svg>
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Sort header component ────────────────────────────

function SortHeader({
  label,
  sortKey,
  currentKey,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey | null;
  dir: SortDir;
  onClick: (key: SortKey) => void;
}) {
  const isActive = currentKey === sortKey;

  return (
    <th className="px-3 py-2 text-center">
      <button
        onClick={() => onClick(sortKey)}
        className={`font-mono text-xs uppercase tracking-wide transition-colors ${
          isActive ? "text-fire" : "text-muted hover:text-ink"
        }`}
      >
        {label}
        <span className="ml-1 text-[10px]">
          {isActive ? (dir === "asc" ? "\u25B2" : "\u25BC") : "\u25B2\u25BC"}
        </span>
      </button>
    </th>
  );
}

// ── Rating cell with loading indicator ───────────────

function RatingCell({ value, isEnriching }: { value: number | null; isEnriching: boolean }) {
  if (value !== null) {
    return <span className="text-ink">{value.toFixed(1)}</span>;
  }

  return (
    <span className="inline-flex items-center gap-1 text-muted/40">
      {"\u2014"}
      {isEnriching && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full bg-fire/60 animate-pulse"
          title="Fetching ratings — check back shortly"
        />
      )}
    </span>
  );
}

// ── Inline star rating ───────────────────────────────

function InlineStarRating({
  bookId,
  currentRating,
  isOwner,
  onRate,
}: {
  bookId: string;
  currentRating: number | null;
  isOwner: boolean;
  onRate?: (bookId: string, stars: number) => void;
}) {
  const [hovering, setHovering] = useState<number | null>(null);

  if (!isOwner) {
    return (
      <span className="font-mono text-sm text-gold">
        {currentRating ? `${"★".repeat(currentRating)}` : "\u2014"}
      </span>
    );
  }

  const display = hovering ?? currentRating ?? 0;

  return (
    <div className="flex gap-0.5 justify-center" onMouseLeave={() => setHovering(null)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onMouseEnter={() => setHovering(star)}
          onClick={() => onRate?.(bookId, star)}
          className={`text-sm transition-colors ${
            star <= display ? "text-gold" : "text-muted/20"
          } hover:scale-110`}
        >
          ★
        </button>
      ))}
    </div>
  );
}
