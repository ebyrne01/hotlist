"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";

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

export default function TropeFilterClient({
  primaryTrope,
  relatedTropes,
  initialBooks,
  initialBookCount,
}: Props) {
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([primaryTrope.slug]);
  const [books, setBooks] = useState<ShapedBook[]>(initialBooks);
  const [bookCount, setBookCount] = useState(initialBookCount);
  const [loading, setLoading] = useState(false);

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

  function handleToggle(slug: string) {
    let next: string[];

    if (slug === primaryTrope.slug) {
      // Can't deselect the primary trope
      return;
    }

    if (selectedSlugs.includes(slug)) {
      // Deselect
      next = selectedSlugs.filter((s) => s !== slug);
    } else {
      // Select
      next = [...selectedSlugs, slug];
    }

    setSelectedSlugs(next);
    fetchBooks(next);
  }

  const selectedNames = new Set(
    [primaryTrope, ...relatedTropes]
      .filter((t) => selectedSlugs.includes(t.slug))
      .map((t) => t.name)
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink italic">
          {primaryTrope.name}
        </h1>
        {primaryTrope.description && (
          <p className="mt-2 text-sm font-body text-muted max-w-lg">
            {primaryTrope.description}
          </p>
        )}
        <p className="mt-1 text-xs font-mono text-muted/60">
          {bookCount} book{bookCount !== 1 ? "s" : ""} matching
          {selectedSlugs.length > 1 && (
            <span> all {selectedSlugs.length} tropes</span>
          )}
        </p>
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
            No books match all selected tropes
          </p>
          <p className="text-sm font-body text-muted/60 mt-2">
            Try removing a trope to broaden results
          </p>
        </div>
      ) : !loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {books.map((book) => (
            <Link
              key={book.id}
              href={`/book/${book.slug}`}
              className="flex gap-3 p-3 bg-white border border-border rounded-lg hover:border-muted/40 transition-colors"
            >
              {book.coverUrl ? (
                <Image
                  src={book.coverUrl}
                  alt={book.title}
                  width={56}
                  height={84}
                  className="rounded-md object-cover shrink-0"
                />
              ) : (
                <div className="w-14 h-[84px] rounded-md bg-cream shrink-0 flex items-center justify-center">
                  <span className="text-[9px] text-muted italic text-center px-1">
                    {book.title}
                  </span>
                </div>
              )}
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
                    <span className="text-xs font-mono text-fire/70">
                      {"🌶️".repeat(book.spiceLevel)}
                    </span>
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
      ) : null}
    </div>
  );
}
