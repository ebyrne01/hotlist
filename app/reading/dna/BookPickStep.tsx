"use client";

import { useState, useEffect, useRef } from "react";
import { clsx } from "clsx";
import BookCover from "@/components/ui/BookCover";

interface CandidateBook {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
}

interface BookPickStepProps {
  books: CandidateBook[];
  selected: Set<string>;
  onToggle: (bookId: string) => void;
}

const MIN_BOOKS = 3;

export default function BookPickStep({ books, selected, onToggle }: BookPickStepProps) {
  const [authorQuery, setAuthorQuery] = useState("");
  const [authorResults, setAuthorResults] = useState<CandidateBook[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounced author search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (authorQuery.trim().length < 2) {
      setAuthorResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/reading-dna/author-books?q=${encodeURIComponent(authorQuery.trim())}`
        );
        if (res.ok) {
          const data = await res.json();
          setAuthorResults(data.books ?? []);
        }
      } catch {
        // Silently fail — user can still pick from the grid
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [authorQuery]);

  // Merge author results with trope-filtered books, deduplicating by ID
  const existingIds = new Set(books.map((b) => b.id));
  const uniqueAuthorResults = authorResults.filter((b) => !existingIds.has(b.id));
  const showAuthorSection = uniqueAuthorResults.length > 0;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold text-ink">
          Pick books you loved
        </h2>
        <p className="text-sm font-body text-muted mt-2">
          Select at least {MIN_BOOKS}. Tap covers to select.
        </p>
        {selected.size > 0 && (
          <p className="text-sm font-mono text-fire mt-1">
            {selected.size} selected
          </p>
        )}
      </div>

      {/* Author search */}
      <div className="max-w-sm mx-auto">
        <input
          type="text"
          value={authorQuery}
          onChange={(e) => setAuthorQuery(e.target.value)}
          placeholder="Search by author name..."
          className="w-full px-4 py-2.5 rounded-lg border border-border bg-white font-body text-sm text-ink placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-fire/30 focus:border-fire/40 transition-colors"
        />
        {searching && (
          <p className="text-xs text-muted font-body mt-1 text-center">Searching...</p>
        )}
        {authorQuery.trim().length >= 2 && !searching && authorResults.length === 0 && (
          <p className="text-xs text-muted font-body mt-1 text-center">
            No books found for that author
          </p>
        )}
      </div>

      {/* Author search results */}
      {showAuthorSection && (
        <div>
          <p className="text-xs font-mono text-muted uppercase tracking-wide mb-2 px-1">
            Books by {authorResults[0]?.author ?? "author"}
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 max-w-3xl mx-auto">
            {uniqueAuthorResults.map((book) => (
              <BookButton
                key={book.id}
                book={book}
                isSelected={selected.has(book.id)}
                onToggle={onToggle}
              />
            ))}
          </div>
        </div>
      )}

      {/* Trope-filtered book grid */}
      {books.length > 0 && (
        <div>
          {showAuthorSection && (
            <p className="text-xs font-mono text-muted uppercase tracking-wide mb-2 px-1">
              Based on your tropes
            </p>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 max-w-3xl mx-auto">
            {books.map((book) => (
              <BookButton
                key={book.id}
                book={book}
                isSelected={selected.has(book.id)}
                onToggle={onToggle}
              />
            ))}
          </div>
        </div>
      )}

      {selected.size > 0 && selected.size < MIN_BOOKS && (
        <p className="text-center text-xs text-muted font-body">
          {MIN_BOOKS - selected.size} more to go
        </p>
      )}
    </div>
  );
}

function BookButton({
  book,
  isSelected,
  onToggle,
}: {
  book: CandidateBook;
  isSelected: boolean;
  onToggle: (bookId: string) => void;
}) {
  return (
    <button
      onClick={() => onToggle(book.id)}
      className={clsx(
        "relative rounded-lg overflow-hidden transition-all",
        isSelected
          ? "ring-3 ring-fire scale-[1.02]"
          : "hover:scale-[1.02] hover:ring-2 hover:ring-fire/30"
      )}
      title={`${book.title} by ${book.author}`}
    >
      <BookCover title={book.title} coverUrl={book.coverUrl} size="md" />
      {isSelected && (
        <div className="absolute inset-0 bg-fire/20 flex items-center justify-center">
          <span className="bg-fire text-white rounded-full w-7 h-7 flex items-center justify-center text-sm font-bold shadow-md">
            ✓
          </span>
        </div>
      )}
    </button>
  );
}
