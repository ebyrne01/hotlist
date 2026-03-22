"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import BookCover from "@/components/ui/BookCover";
import { PepperRow } from "@/components/ui/PepperIcon";

interface ShapedBook {
  id: string;
  title: string;
  author: string;
  slug: string;
  coverUrl: string | null;
  goodreadsRating: number | null;
  spiceLevel: number | null;
  tropes: string[];
}

interface TropeInfo {
  slug: string;
  name: string;
  count: number;
}

interface Props {
  primaryTrope: { slug: string; name: string; description: string | null };
  relatedTropes: TropeInfo[];
  initialBooks: ShapedBook[];
  initialBookCount: number;
}

const PAGE_SIZE = 18;

export default function TropeFilterClient({
  primaryTrope,
  relatedTropes,
  initialBooks,
  initialBookCount,
}: Props) {
  const searchParams = useSearchParams();
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([primaryTrope.slug]);
  const [books, setBooks] = useState<ShapedBook[]>(initialBooks);
  const [bookCount, setBookCount] = useState(initialBookCount);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<string>("rating");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const fetchBooks = useCallback(async (slugs: string[]) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/books/by-tropes?slugs=${slugs.join(",")}`);
      const data = await res.json();
      setBooks(data.books ?? []);
      setBookCount(data.books?.length ?? 0);
    } catch {
      // Keep current books on error
    } finally {
      setLoading(false);
    }
  }, []);

  // Restore filter state from URL on mount
  useEffect(() => {
    const also = searchParams.get("also");
    if (also) {
      const additionalSlugs = also.split(",").filter(Boolean);
      const validSlugs = additionalSlugs.filter((s) =>
        relatedTropes.some((t) => t.slug === s)
      );
      if (validSlugs.length > 0) {
        const allSlugs = [primaryTrope.slug, ...validSlugs];
        setSelectedSlugs(allSlugs);
        fetchBooks(allSlugs);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleToggle(slug: string) {
    if (slug === primaryTrope.slug) return;

    let next: string[];
    if (selectedSlugs.includes(slug)) {
      next = selectedSlugs.filter((s) => s !== slug);
    } else {
      next = [...selectedSlugs, slug];
    }

    // Push filter state to URL
    const additionalSlugs = next.filter((s) => s !== primaryTrope.slug);
    const params = new URLSearchParams(window.location.search);
    if (additionalSlugs.length > 0) {
      params.set("also", additionalSlugs.join(","));
    } else {
      params.delete("also");
    }
    const newUrl = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`;
    window.history.replaceState({}, "", newUrl);

    setSelectedSlugs(next);
    setVisibleCount(PAGE_SIZE);
    fetchBooks(next);
  }

  function handleSortChange(value: string) {
    setSortBy(value);
    setVisibleCount(PAGE_SIZE);
  }

  const selectedNames = new Set(
    [primaryTrope, ...relatedTropes]
      .filter((t) => selectedSlugs.includes(t.slug))
      .map((t) => t.name)
  );

  // Sort books client-side
  const sortedBooks = useMemo(() => {
    return [...books].sort((a, b) => {
      switch (sortBy) {
        case "rating":
          return (b.goodreadsRating ?? 0) - (a.goodreadsRating ?? 0);
        case "spice":
          return (b.spiceLevel ?? 0) - (a.spiceLevel ?? 0);
        case "title":
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });
  }, [books, sortBy]);

  const visibleBooks = sortedBooks.slice(0, visibleCount);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-3 text-xs font-mono text-muted" aria-label="Breadcrumb">
        <Link
          href="/#tropes"
          className="hover:text-fire transition-colors"
        >
          &larr; All Tropes
        </Link>
      </nav>

      <header className="mb-6">
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink italic">
          {primaryTrope.name}
        </h1>
        {primaryTrope.description && (
          <p className="mt-2 text-sm font-body text-muted max-w-lg">
            {primaryTrope.description}
          </p>
        )}
      </header>

      {/* Multi-select trope pills */}
      {relatedTropes.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-mono text-muted uppercase tracking-wide mb-2">
            Refine by adding tropes
          </p>
          <div className="flex flex-wrap gap-2">
            {/* Primary trope (always selected, not toggleable) */}
            <span className="px-3 py-1.5 rounded-full text-xs font-mono bg-fire/10 border border-fire/30 text-fire">
              {primaryTrope.name}
            </span>

            {/* Related tropes (toggleable) */}
            {relatedTropes.map((trope) => {
              const active = selectedSlugs.includes(trope.slug);
              return (
                <button
                  key={trope.slug}
                  type="button"
                  onClick={() => handleToggle(trope.slug)}
                  className={`px-3 py-1.5 rounded-full text-xs font-mono transition-colors border ${
                    active
                      ? "bg-[#F5EFE0] border-[#D4B87A] text-[#6B5A2E]"
                      : "bg-cream border-border text-muted hover:border-muted/40"
                  }`}
                >
                  {trope.name}
                  <span className="ml-1 opacity-50">({trope.count})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="py-8 text-center">
          <div className="w-6 h-6 border-2 border-fire border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      )}

      {/* Book grid */}
      {!loading && books.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-lg font-body text-muted">
            {selectedSlugs.length > 1
              ? "No books match all selected tropes"
              : `No books tagged with ${primaryTrope.name} yet`}
          </p>
          <p className="text-sm font-body text-muted/60 mt-2">
            {selectedSlugs.length > 1
              ? "Try removing a trope to broaden results"
              : "Check back soon \u2014 we\u2019re adding more every day"}
          </p>
        </div>
      ) : !loading ? (
        <>
          {/* Sort + count bar */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-mono text-muted/60">
              {bookCount} book{bookCount !== 1 ? "s" : ""}
              {selectedSlugs.length > 1 && (
                <span> matching all {selectedSlugs.length} tropes</span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <label htmlFor="sort-select" className="text-xs font-mono text-muted">
                Sort by
              </label>
              <select
                id="sort-select"
                value={sortBy}
                onChange={(e) => handleSortChange(e.target.value)}
                className="text-xs font-mono border border-border rounded-lg px-2 py-1.5 bg-white text-ink focus:ring-2 focus:ring-fire/30 focus:border-fire/40 focus:outline-none"
              >
                <option value="rating">Highest Rated</option>
                <option value="spice">Most Spicy</option>
                <option value="title">Title A&ndash;Z</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visibleBooks.map((book) => (
              <Link
                key={book.id}
                href={`/book/${book.slug}`}
                className="flex gap-3 p-3 bg-white border border-border rounded-lg hover:border-muted/40 transition-colors"
              >
                <div className="w-14 h-[84px] shrink-0 overflow-hidden">
                  <BookCover
                    title={book.title}
                    coverUrl={book.coverUrl}
                    size="sm"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-sm font-bold text-ink leading-tight truncate">
                    {book.title}
                  </h3>
                  <p className="text-xs font-body text-muted mt-0.5">{book.author}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    {book.goodreadsRating && (
                      <span className="text-xs font-mono text-muted">
                        {book.goodreadsRating.toFixed(1)} GR
                      </span>
                    )}
                    {book.spiceLevel && book.spiceLevel > 0 && (
                      <PepperRow level={book.spiceLevel} size={12} />
                    )}
                  </div>
                  {/* Show which selected tropes this book has */}
                  {selectedSlugs.length > 1 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {book.tropes
                        .filter((t) => selectedNames.has(t))
                        .map((t) => (
                          <span
                            key={t}
                            className="text-[10px] font-mono text-[#6B5A2E] bg-[#F5EFE0] px-1.5 py-0.5 rounded"
                          >
                            {t}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>

          {/* Show more */}
          {visibleCount < sortedBooks.length && (
            <div className="text-center mt-6">
              <button
                onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                className="px-5 py-2.5 bg-white border border-border rounded-lg text-sm font-mono text-ink hover:border-fire/30 hover:text-fire transition-colors"
              >
                Show more ({sortedBooks.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
