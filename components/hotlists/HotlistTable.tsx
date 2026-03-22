"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import BookCover from "@/components/ui/BookCover";
import { PepperRow } from "@/components/ui/PepperIcon";
import type { HotlistBookDetail, Rating, SpiceRating } from "@/lib/types";

interface HotlistTableProps {
  books: HotlistBookDetail[];
  isOwner: boolean;
  onRemoveBook?: (bookId: string) => void;
  onRateBook?: (bookId: string, stars: number) => void;
  affiliateTag?: string;
  /** Book IDs currently being enriched in the background */
  enrichingBookIds?: Set<string>;
}

type SortKey = "goodreads" | "amazon" | "romance_io" | "spice";
type SortDir = "asc" | "desc";

function getRating(ratings: Rating[], source: string): number | null {
  const r = ratings.find((r) => r.source === source);
  return r?.rating ?? null;
}

function getSpiceLevel(book: HotlistBookDetail): number {
  // Prefer composite score
  if (book.book.compositeSpice) return book.book.compositeSpice.score;
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

function bnSearchUrl(title: string, author: string): string {
  const query = encodeURIComponent(`${title} ${author}`);
  return `https://www.barnesandnoble.com/s/${query}?store=EBOOK`;
}

function bookshopSearchUrl(title: string, author: string): string {
  const query = encodeURIComponent(`${title} ${author}`);
  return `https://bookshop.org/books/search?keywords=${query}`;
}

/** Check if a book has any ratings data at all */
function hasAnyRatings(hb: HotlistBookDetail): boolean {
  return hb.book.ratings.some((r) => r.rating !== null);
}

/** Build a Goodreads book page URL */
function goodreadsUrl(goodreadsId: string | null): string | null {
  return goodreadsId ? `https://www.goodreads.com/book/show/${goodreadsId}` : null;
}

/** Build a romance.io book page URL */
function romanceIoUrl(slug: string | null, title: string, author: string): string {
  // Slugs with "/" have the full id/slug path (e.g. "67d.../title-author") — use direct link
  // Legacy slugs without "/" are missing the required ID — use Google search fallback
  // (romance.io search is JS-based with no URL query support)
  return slug && slug.includes("/")
    ? `https://www.romance.io/books/${slug}`
    : `https://www.google.com/search?q=${encodeURIComponent(`site:romance.io "${title}" "${author}"`)}`;
}

/** Build an Amazon product page URL */
function amazonProductUrl(asin: string | null, title: string, author: string, tag: string): string {
  if (asin) return `https://www.amazon.com/dp/${asin}${tag ? `?tag=${tag}` : ""}`;
  return amazonSearchUrl(title, author, tag);
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
    }

    // Nulls sort last
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;

    return sortDir === "asc" ? aVal - bVal : bVal - aVal;
  });

  // Compute which rating columns have data
  const hasAnyAmazon = books.some((hb) => getRating(hb.book.ratings, "amazon") !== null);
  const hasAnyRomanceIo = books.some((hb) => getRating(hb.book.ratings, "romance_io") !== null);

  // Compute trope frequency for shared-trope highlighting
  const tropeFrequency = new Map<string, number>();
  for (const hb of books) {
    for (const trope of hb.book.tropes) {
      tropeFrequency.set(trope.name, (tropeFrequency.get(trope.name) ?? 0) + 1);
    }
  }

  if (books.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed border-border rounded-lg">
        <p className="font-display text-lg font-bold text-ink">
          Your Hotlist is empty &mdash; let&apos;s fix that
        </p>
        <p className="font-body text-muted text-sm mt-2 max-w-sm mx-auto">
          Search for books to add, then compare ratings, spice levels, and tropes side by side to decide what to read next.
        </p>
        <Link
          href="/booktok"
          className="inline-flex items-center gap-2 mt-4 text-sm font-mono text-fire hover:text-fire/80 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
          Or paste a BookTok link to add all books at once &rarr;
        </Link>
      </div>
    );
  }

  const tag = affiliateTag ?? process.env.NEXT_PUBLIC_AMAZON_AFFILIATE_TAG ?? "";

  return (
    <>
      {/* ── Mobile: Card layout ──────────────────────── */}
      <div className="sm:hidden space-y-3 -mx-2">
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
            <div key={hb.id} className="bg-white rounded-lg border border-border/60 p-3">
              <div className="flex gap-3">
                {/* Cover + title */}
                <Link href={`/book/${slug}`} className="shrink-0">
                  <BookCover title={hb.book.title} coverUrl={hb.book.coverUrl} size="sm" isAudiobook={hb.book.isAudiobook} />
                </Link>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/book/${slug}`} className="min-w-0">
                      <p className="font-display font-bold text-ink text-sm leading-tight truncate">
                        {hb.book.title}
                      </p>
                      <p className="text-xs font-body text-muted truncate">{hb.book.author}</p>
                    </Link>
                    {isOwner && (
                      <button
                        onClick={() => onRemoveBook?.(hb.bookId)}
                        className="text-muted/70 hover:text-fire transition-colors p-1 shrink-0"
                        title="Remove"
                      >
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <line x1="3" y1="3" x2="11" y2="11" />
                          <line x1="11" y1="3" x2="3" y2="11" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Ratings row */}
                  <div className="flex items-center gap-3 mt-2 font-mono">
                    {gr !== null && hb.book.goodreadsId ? (
                      <a
                        href={goodreadsUrl(hb.book.goodreadsId)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-baseline gap-1 hover:text-fire transition-colors"
                        aria-label={`Goodreads rating: ${gr.toFixed(1)}`}
                      >
                        <span className="text-[10px] uppercase tracking-wide text-muted/70">GR</span>
                        <span className="text-sm text-ink">{gr.toFixed(1)}</span>
                      </a>
                    ) : (
                      <span className="inline-flex items-baseline gap-1" aria-label={`Goodreads rating: ${gr !== null ? gr.toFixed(1) : 'not available'}`}>
                        <span className="text-[10px] uppercase tracking-wide text-muted/70">GR</span>
                        <span className="text-sm"><RatingCell value={gr} isEnriching={isEnriching && noRatings} /></span>
                      </span>
                    )}
                    {amz !== null && (
                      <>
                        <span className="text-border" aria-hidden="true">&middot;</span>
                        <a
                          href={amazonProductUrl(hb.book.amazonAsin, hb.book.title, hb.book.author, tag)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-baseline gap-1 hover:text-fire transition-colors"
                          aria-label={`Amazon rating: ${amz.toFixed(1)}`}
                        >
                          <span className="text-[10px] uppercase tracking-wide text-muted/70">AMZ</span>
                          <span className="text-sm text-ink">{amz.toFixed(1)}</span>
                        </a>
                      </>
                    )}
                    {rio !== null && (
                      <>
                        <span className="text-border" aria-hidden="true">&middot;</span>
                        <a
                          href={romanceIoUrl(hb.book.romanceIoSlug, hb.book.title, hb.book.author)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-baseline gap-1 hover:text-fire transition-colors"
                          aria-label={`romance.io rating: ${rio.toFixed(1)}`}
                        >
                          <span className="text-[10px] uppercase tracking-wide text-muted/70">RIO</span>
                          <span className="text-sm text-ink">{rio.toFixed(1)}</span>
                        </a>
                      </>
                    )}
                  </div>

                  {/* Spice + My Rating + Buy */}
                  <div className="flex items-center gap-3 mt-1.5">
                    {spice > 0 ? (
                      (() => {
                        const isRioSource = hb.book.compositeSpice?.primarySource === "romance_io";
                        const mobileSpice = (
                          <span
                            className="text-sm"
                            title={hb.book.compositeSpice
                              ? `${hb.book.compositeSpice.score.toFixed(1)}/5 spice · ${hb.book.compositeSpice.attribution}`
                              : `${spice}/5 spice`}
                          >
                            <PepperRow
                              level={spice}
                              size={14}
                              estimated={hb.book.compositeSpice ? !["community", "romance_io"].includes(hb.book.compositeSpice.primarySource) : false}
                              muted={!!hb.book.compositeSpice?.conflictFlag}
                            />
                            {hb.book.compositeSpice?.conflictFlag && (
                              <SpiceVariesTooltip spiceSignals={hb.book.spice} />
                            )}
                          </span>
                        );
                        return isRioSource ? (
                          <a
                            href={romanceIoUrl(hb.book.romanceIoSlug, hb.book.title, hb.book.author)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:opacity-80 transition-opacity"
                          >
                            {mobileSpice}
                          </a>
                        ) : mobileSpice;
                      })()
                    ) : hb.book.spice.length > 0 || hb.book.compositeSpice ? (
                      <span className="text-[10px] font-mono text-muted/60">Low spice</span>
                    ) : null}
                    <InlineStarRating
                      bookId={hb.bookId}
                      currentRating={hb.userRating?.starRating ?? null}
                      isOwner={isOwner}
                      onRate={onRateBook}
                    />
                    <span className="ml-auto">
                      <BuyDropdown
                        title={hb.book.title}
                        author={hb.book.author}
                        asin={asin}
                        tag={tag}
                      />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Desktop: Table layout ────────────────────── */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-3 py-2 font-mono text-xs text-muted uppercase tracking-wide">
                Book
              </th>
              <SortHeader label="Goodreads" sortKey="goodreads" currentKey={sortKey} dir={sortDir} onClick={handleSort} />
              {hasAnyAmazon && (
                <SortHeader label="Amazon" sortKey="amazon" currentKey={sortKey} dir={sortDir} onClick={handleSort} />
              )}
              {hasAnyRomanceIo && (
                <SortHeader label="romance.io" sortKey="romance_io" currentKey={sortKey} dir={sortDir} onClick={handleSort} />
              )}
              <SortHeader label="Spice" sortKey="spice" currentKey={sortKey} dir={sortDir} onClick={handleSort} />
              <th className="text-center px-3 py-2 font-mono text-xs text-muted uppercase tracking-wide">
                My Rating
              </th>
              <th className="text-left px-3 py-2 font-mono text-xs text-muted uppercase tracking-wide">
                Tropes
              </th>
              <th className="text-center px-3 py-2 font-mono text-xs text-muted uppercase tracking-wide">
                Status
              </th>
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
                  <td className="px-3 py-3">
                    <Link href={`/book/${slug}`} className="flex items-center gap-3 group">
                      <BookCover title={hb.book.title} coverUrl={hb.book.coverUrl} size="table" isAudiobook={hb.book.isAudiobook} />
                      <div className="min-w-0">
                        <p className="font-display font-bold text-ink text-sm leading-tight group-hover:text-fire transition-colors line-clamp-2">
                          {hb.book.title}
                        </p>
                        <p className="text-xs font-body text-muted line-clamp-1">
                          {hb.book.author}
                        </p>
                      </div>
                    </Link>
                  </td>

                  <td className="px-3 py-3 text-center font-mono text-sm">
                    {gr !== null && hb.book.goodreadsId ? (
                      <a
                        href={goodreadsUrl(hb.book.goodreadsId)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ink hover:text-fire transition-colors"
                        title="View on Goodreads"
                      >
                        {gr.toFixed(1)}
                        <span className="inline-block ml-0.5 text-muted/40 text-[10px]">{"\u2197"}</span>
                      </a>
                    ) : (
                      <RatingCell value={gr} isEnriching={isEnriching && noRatings} />
                    )}
                  </td>
                  {hasAnyAmazon && (
                    <td className="px-3 py-3 text-center font-mono text-sm">
                      {amz !== null ? (
                        <a
                          href={amazonProductUrl(hb.book.amazonAsin, hb.book.title, hb.book.author, tag)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink hover:text-fire transition-colors"
                          title="View on Amazon"
                        >
                          {amz.toFixed(1)}
                          <span className="inline-block ml-0.5 text-muted/40 text-[10px]">{"\u2197"}</span>
                        </a>
                      ) : (
                        <RatingCell value={amz} isEnriching={isEnriching && noRatings} />
                      )}
                    </td>
                  )}
                  {hasAnyRomanceIo && (
                    <td className="px-3 py-3 text-center font-mono text-sm">
                      {rio !== null ? (
                        <a
                          href={romanceIoUrl(hb.book.romanceIoSlug, hb.book.title, hb.book.author)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink hover:text-fire transition-colors"
                          title="View on romance.io"
                        >
                          {rio.toFixed(1)}
                          <span className="inline-block ml-0.5 text-muted/40 text-[10px]">{"\u2197"}</span>
                        </a>
                      ) : (
                        <RatingCell value={rio} isEnriching={isEnriching && noRatings} />
                      )}
                    </td>
                  )}
                  <td className="px-3 py-3 text-center">
                    {spice > 0 ? (
                      (() => {
                        const isRioSource = hb.book.compositeSpice?.primarySource === "romance_io";
                        const spiceContent = (
                          <span
                            className={`text-sm ${isRioSource ? "cursor-pointer" : "cursor-default"}`}
                            title={hb.book.compositeSpice
                              ? `${hb.book.compositeSpice.score.toFixed(1)}/5 spice · ${hb.book.compositeSpice.attribution}`
                              : `${spice}/5 spice`}
                          >
                            <PepperRow
                              level={spice}
                              size={14}
                              estimated={hb.book.compositeSpice ? !["community", "romance_io"].includes(hb.book.compositeSpice.primarySource) : false}
                              muted={!!hb.book.compositeSpice?.conflictFlag}
                            />
                            {hb.book.compositeSpice?.conflictFlag && (
                              <SpiceVariesTooltip spiceSignals={hb.book.spice} />
                            )}
                            {spice <= 2 && hb.book.compositeSpice && (
                              <span className="block text-[10px] font-mono text-muted/60">Low spice</span>
                            )}
                          </span>
                        );
                        return isRioSource ? (
                          <a
                            href={romanceIoUrl(hb.book.romanceIoSlug, hb.book.title, hb.book.author)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:opacity-80 transition-opacity"
                            title="Spice rating from romance.io"
                          >
                            {spiceContent}
                          </a>
                        ) : spiceContent;
                      })()
                    ) : hb.book.spice.length > 0 || hb.book.compositeSpice ? (
                      <span className="text-sm cursor-default" title="Confirmed low/no spice">
                        <PepperRow level={1} size={14} estimated muted />
                        <span className="block text-[10px] font-mono text-muted/60">Low spice</span>
                      </span>
                    ) : (
                      <span className="text-muted/50 font-mono text-[10px]">Unknown</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <InlineStarRating
                      bookId={hb.bookId}
                      currentRating={hb.userRating?.starRating ?? null}
                      isOwner={isOwner}
                      onRate={onRateBook}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1 flex-wrap max-w-[180px]">
                      {hb.book.tropes.slice(0, 3).map((t) => {
                        const isShared = (tropeFrequency.get(t.name) ?? 0) >= 2;
                        return (
                          <Link key={t.id} href={`/tropes/${t.slug}`}>
                            <span
                              className={`text-[10px] font-mono px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                                isShared
                                  ? "bg-fire/10 text-fire/80 border border-fire/20 hover:bg-fire/15"
                                  : "bg-cream text-muted border border-border hover:border-muted/40"
                              }`}
                            >
                              {t.name}
                            </span>
                          </Link>
                        );
                      })}
                      {hb.book.tropes.length > 3 && (
                        <span className="text-xs font-mono text-muted/60">+{hb.book.tropes.length - 3}</span>
                      )}
                      {hb.book.tropes.length === 0 && (
                        <span className="text-muted/70 font-mono text-xs">{"\u2014"}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <ReadStatusToggle
                      bookId={hb.bookId}
                      isOwner={isOwner}
                    />
                  </td>
                  <td className="px-3 py-3 text-center">
                    <BuyDropdown
                      title={hb.book.title}
                      author={hb.book.author}
                      asin={asin}
                      tag={tag}
                    />
                  </td>
                  {isOwner && (
                    <td className="px-2 py-3 text-center">
                      <button
                        onClick={() => onRemoveBook?.(hb.bookId)}
                        className="text-muted/70 hover:text-fire transition-colors p-1"
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
    </>
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
        <span className="ml-1 text-xs">
          {isActive ? (dir === "asc" ? "\u25B2" : "\u25BC") : "\u25B2\u25BC"}
        </span>
      </button>
    </th>
  );
}

// ── Rating cell with loading indicator ───────────────

function RatingCell({ value, isEnriching }: { value: number | null; isEnriching: boolean }) {
  if (value !== null) {
    return <span className="font-medium text-ink">{value.toFixed(1)}</span>;
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

// ── Buy dropdown ─────────────────────────────────────

function BuyDropdown({
  title,
  author,
  asin,
  tag,
}: {
  title: string;
  author: string;
  asin: string | null;
  tag: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const amazonUrl = asin
    ? `https://www.amazon.com/dp/${asin}?tag=${tag}`
    : amazonSearchUrl(title, author, tag);
  const bnUrl = bnSearchUrl(title, author);
  const bookshopUrl = bookshopSearchUrl(title, author);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-mono text-fire hover:underline whitespace-nowrap"
      >
        Buy &rarr;
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-border rounded-lg shadow-lg py-1 z-30 min-w-[120px]">
          <a
            href={amazonUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-3 py-1.5 text-xs font-mono text-ink hover:bg-cream transition-colors"
            onClick={() => setOpen(false)}
          >
            Amazon
          </a>
          <a
            href={bnUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-3 py-1.5 text-xs font-mono text-ink hover:bg-cream transition-colors"
            onClick={() => setOpen(false)}
          >
            B&amp;N
          </a>
          <a
            href={bookshopUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-3 py-1.5 text-xs font-mono text-ink hover:bg-cream transition-colors"
            onClick={() => setOpen(false)}
          >
            Bookshop
          </a>
        </div>
      )}
    </div>
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
            star <= display ? "text-gold" : "text-muted/40"
          } hover:scale-110`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ── Read status toggle ───────────────────────────────

function ReadStatusToggle({
  bookId,
  isOwner,
}: {
  bookId: string;
  isOwner: boolean;
}) {
  const [status, setStatus] = useState<"read" | "unread">("unread");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    import("@/lib/supabase/client").then(({ createClient }) => {
      const sb = createClient();
      sb.auth.getUser().then(({ data }) => {
        if (!data.user) { setLoaded(true); return; }
        sb.from("reading_status")
          .select("status")
          .eq("user_id", data.user.id)
          .eq("book_id", bookId)
          .single()
          .then(({ data: rs }) => {
            setStatus(rs?.status === "read" ? "read" : "unread");
            setLoaded(true);
          });
      });
    });
  }, [bookId, isOwner]);

  async function toggle() {
    const newStatus = status === "read" ? "unread" : "read";
    setStatus(newStatus);

    const { createClient } = await import("@/lib/supabase/client");
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    if (newStatus === "read") {
      await sb.from("reading_status").upsert(
        { user_id: user.id, book_id: bookId, status: "read", updated_at: new Date().toISOString() },
        { onConflict: "user_id,book_id" }
      );
    } else {
      await sb.from("reading_status")
        .delete()
        .eq("user_id", user.id)
        .eq("book_id", bookId);
    }
  }

  if (!isOwner || !loaded) {
    return <span className="text-muted/70 font-mono text-xs">{"\u2014"}</span>;
  }

  return (
    <button
      onClick={toggle}
      className={`text-xs font-mono px-2 py-1 rounded-full border transition-colors ${
        status === "read"
          ? "bg-green-50 text-green-700 border-green-200"
          : "bg-white text-muted border-border hover:border-fire/30 hover:text-ink"
      }`}
    >
      {status === "read" ? "Read" : "Unread"}
    </button>
  );
}

// ── Spice "varies" tooltip ────────────────────────────

const spiceSourceLabels: Record<string, string> = {
  romance_io: "Romance.io",
  hotlist_community: "Community",
  goodreads_inference: "Goodreads (est.)",
};

function pepperString(level: number): string {
  const filled = Math.round(level);
  return "\uD83C\uDF36\uFE0F".repeat(filled);
}

function SpiceVariesTooltip({ spiceSignals }: { spiceSignals: SpiceRating[] }) {
  const [open, setOpen] = useState(false);

  if (spiceSignals.length === 0) {
    return <span className="block text-xs font-mono text-fire/70 italic">varies</span>;
  }

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((o) => !o)}
    >
      <span className="block text-xs font-mono text-fire/70 italic cursor-help underline decoration-dotted underline-offset-2">
        varies
      </span>
      {open && (
        <span className="absolute z-40 bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-ink text-cream rounded-lg shadow-lg px-3 py-2 text-left whitespace-nowrap">
          <span className="block text-[10px] font-mono uppercase tracking-wide text-cream/60 mb-1">
            Spice signals vary
          </span>
          {spiceSignals.map((s) => (
            <span key={s.source} className="block text-xs font-mono leading-relaxed">
              {spiceSourceLabels[s.source] ?? s.source}: {pepperString(s.spiceLevel)} ({s.spiceLevel.toFixed(1)})
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
