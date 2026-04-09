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
  genre: { slug: string; label: string; description: string };
  topTropes: TropeInfo[];
  initialBooks: ShapedBook[];
  initialBookCount: number;
}

const PAGE_SIZE = 18;

export default function GenreFilterClient({
  genre,
  topTropes,
  initialBooks,
  initialBookCount,
}: Props) {
  const searchParams = useSearchParams();
  const [selectedTropes, setSelectedTropes] = useState<string[]>([]);
  const [books, setBooks] = useState<ShapedBook[]>(initialBooks);
  const [bookCount, setBookCount] = useState(initialBookCount);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<string>("popular");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const fetchBooks = useCallback(async (tropes: string[]) => {
    setLoading(true);
    try {
      const tropeParam =
        tropes.length > 0 ? `&tropes=${tropes.join(",")}` : "";
      const res = await fetch(
        `/api/books/by-genre?slug=${genre.slug}${tropeParam}`
      );
      const data = await res.json();
      setBooks(data.books ?? []);
      setBookCount(data.books?.length ?? 0);
    } catch {
      // Keep current books on error
    } finally {
      setLoading(false);
    }
  }, [genre.slug]);

  // Restore filter state from URL on mount
  useEffect(() => {
    const also = searchParams.get("tropes");
    if (also) {
      const validSlugs = also
        .split(",")
        .filter((s) => topTropes.some((t) => t.slug === s));
      if (validSlugs.length > 0) {
        setSelectedTropes(validSlugs);
        fetchBooks(validSlugs);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleTrope = useCallback(
    (slug: string) => {
      let next: string[];
      if (selectedTropes.includes(slug)) {
        next = selectedTropes.filter((s) => s !== slug);
      } else {
        next = [...selectedTropes, slug];
      }

      // Push filter state to URL
      const params = new URLSearchParams(window.location.search);
      if (next.length > 0) {
        params.set("tropes", next.join(","));
      } else {
        params.delete("tropes");
      }
      const newUrl = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`;
      window.history.replaceState({}, "", newUrl);

      setSelectedTropes(next);
      setVisibleCount(PAGE_SIZE);

      if (next.length > 0) {
        fetchBooks(next);
      } else {
        // Reset to initial books
        setBooks(initialBooks);
        setBookCount(initialBookCount);
      }
    },
    [selectedTropes, fetchBooks, initialBooks, initialBookCount]
  );

  const selectedTropeNames = new Set(
    topTropes
      .filter((t) => selectedTropes.includes(t.slug))
      .map((t) => t.name)
  );

  const sortedBooks = useMemo(() => {
    if (sortBy === "popular") return books; // Already sorted by popularity from server
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
      <nav
        className="mb-3 text-xs font-mono text-muted"
        aria-label="Breadcrumb"
      >
        <Link href="/" className="hover:text-fire transition-colors">
          Home
        </Link>
        <span className="mx-1">/</span>
        <span>{genre.label}</span>
      </nav>

      <header className="mb-6">
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink italic">
          {genre.label}
        </h1>
        <p className="mt-2 text-sm font-body text-muted max-w-lg">
          {genre.description}
        </p>
      </header>

      {/* Trope filter pills */}
      {topTropes.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-mono text-muted uppercase tracking-wide mb-2">
            Refine by trope
          </p>
          <div className="flex flex-wrap gap-2">
            {/* Genre pill (always selected, not toggleable) */}
            <span className="px-3 py-1.5 rounded-full text-xs font-mono bg-fire/10 border border-fire/30 text-fire">
              {genre.label}
            </span>

            {/* Trope pills */}
            {topTropes.map((trope) => {
              const active = selectedTropes.includes(trope.slug);
              return (
                <button
                  key={trope.slug}
                  type="button"
                  onClick={() => handleToggleTrope(trope.slug)}
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
            {selectedTropes.length > 0
              ? "No books match all selected tropes in this genre"
              : `No ${genre.label.toLowerCase()} books found yet`}
          </p>
          <p className="text-sm font-body text-muted/60 mt-2">
            {selectedTropes.length > 0
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
              {selectedTropes.length > 0 && (
                <span>
                  {" "}
                  with {selectedTropes.length} trope
                  {selectedTropes.length !== 1 ? "s" : ""}
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <label
                htmlFor="genre-sort-select"
                className="text-xs font-mono text-muted"
              >
                Sort by
              </label>
              <select
                id="genre-sort-select"
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  setVisibleCount(PAGE_SIZE);
                }}
                className="text-xs font-mono border border-border rounded-lg px-2 py-1.5 bg-white text-ink focus:ring-2 focus:ring-fire/30 focus:border-fire/40 focus:outline-none"
              >
                <option value="popular">Most Popular</option>
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
                  <p className="text-xs font-body text-muted mt-0.5">
                    {book.author}
                  </p>
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
                  {selectedTropes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {book.tropes
                        .filter((t) => selectedTropeNames.has(t))
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
