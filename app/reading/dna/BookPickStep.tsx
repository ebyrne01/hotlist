"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { clsx } from "clsx";
import BookCover from "@/components/ui/BookCover";

export interface CandidateBook {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  tropes: string[];
}

interface BookPickStepProps {
  selected: Set<string>;
  onToggle: (bookId: string) => void;
  subgenres: Set<string>;
  onPickedBooksChange?: (books: CandidateBook[]) => void;
}

const MIN_BOOKS = 3;

export default function BookPickStep({
  selected,
  onToggle,
  subgenres,
  onPickedBooksChange,
}: BookPickStepProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CandidateBook[]>([]);
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<CandidateBook[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  // Track all picked book data (needed for DislikedBooksStep and DNA computation)
  const [pickedBooks, setPickedBooks] = useState<Map<string, CandidateBook>>(
    new Map()
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Wrap onToggle to also track book data
  const handleToggle = useCallback(
    (book: CandidateBook) => {
      onToggle(book.id);
      setPickedBooks((prev) => {
        const next = new Map(prev);
        if (next.has(book.id)) {
          next.delete(book.id);
        } else {
          next.set(book.id, book);
        }
        return next;
      });
    },
    [onToggle]
  );

  // Notify parent of picked book data changes
  useEffect(() => {
    if (onPickedBooksChange) {
      onPickedBooksChange(Array.from(pickedBooks.values()));
    }
  }, [pickedBooks, onPickedBooksChange]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/reading-dna/search?q=${encodeURIComponent(searchQuery.trim())}`
        );
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.books ?? []);
        }
      } catch {
        // Silently fail
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  // Fetch suggestions when picks change (debounced to avoid grid churn on rapid picks)
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const suggestAbortRef = useRef<AbortController>();
  useEffect(() => {
    if (selected.size === 0) {
      setSuggestions([]);
      return;
    }

    // Debounce: wait 600ms after last pick before re-fetching
    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);

    suggestDebounceRef.current = setTimeout(() => {
      if (suggestAbortRef.current) suggestAbortRef.current.abort();
      const controller = new AbortController();
      suggestAbortRef.current = controller;
      setLoadingSuggestions(true);

      const pickedParam = Array.from(selected).join(",");
      const subgenreParam = Array.from(subgenres).join(",");
      const url = `/api/reading-dna/suggestions?picked=${encodeURIComponent(pickedParam)}${subgenreParam ? `&subgenres=${encodeURIComponent(subgenreParam)}` : ""}`;

      fetch(url, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : { books: [] }))
        .then((data) => setSuggestions(data.books ?? []))
        .catch(() => {})
        .finally(() => setLoadingSuggestions(false));
    }, 600);

    return () => {
      if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);
    };
  }, [selected, subgenres]);

  // Filter search results to exclude already-picked (search clears on pick anyway)
  const filteredSearch = searchResults.filter((b) => !selected.has(b.id));
  const pickedList = Array.from(pickedBooks.values()).filter((b) =>
    selected.has(b.id)
  );

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold text-ink">
          Pick books you loved
        </h2>
        <p className="text-sm font-body text-muted mt-2">
          Select at least {MIN_BOOKS}. Search for any book by title or author.
        </p>
      </div>

      {/* Your picks row */}
      {pickedList.length > 0 && (
        <div>
          <p className="text-xs font-mono text-muted uppercase tracking-wide mb-2 px-1">
            Your picks ({pickedList.length})
          </p>
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
            {pickedList.map((book) => (
              <button
                key={book.id}
                onClick={() => handleToggle(book)}
                className="relative shrink-0 rounded-lg overflow-hidden ring-2 ring-fire"
                title={`Remove ${book.title}`}
              >
                <BookCover
                  title={book.title}
                  coverUrl={book.coverUrl}
                  size="sm"
                />
                <div className="absolute inset-0 bg-fire/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                  <span className="bg-fire text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                    &times;
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search input */}
      <div className="max-w-sm mx-auto">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={selected.size === 0 ? "Search by title or author..." : "Search for another favorite..."}
          className="w-full px-4 py-2.5 rounded-lg border border-border bg-white font-body text-sm text-ink placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-fire/30 focus:border-fire/40 transition-colors"
        />
        {searching && (
          <p className="text-xs text-muted font-body mt-1 text-center">
            Searching...
          </p>
        )}
        {searchQuery.trim().length >= 2 &&
          !searching &&
          searchResults.length === 0 && (
            <p className="text-xs text-muted font-body mt-1 text-center">
              No books found
            </p>
          )}
      </div>

      {/* Search results */}
      {filteredSearch.length > 0 && (
        <div>
          <p className="text-xs font-mono text-muted uppercase tracking-wide mb-2 px-1">
            Search results
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 max-w-3xl mx-auto">
            {filteredSearch.map((book) => (
              <BookButton
                key={book.id}
                book={book}
                isSelected={selected.has(book.id)}
                onToggle={() => {
                  handleToggle(book);
                  setSearchQuery("");
                  setSearchResults([]);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Suggestions grid */}
      {(suggestions.length > 0 || loadingSuggestions) && (
        <div>
          <p className="text-xs font-mono text-muted uppercase tracking-wide mb-2 px-1">
            You might also love...
          </p>
          {loadingSuggestions && suggestions.length === 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 max-w-3xl mx-auto">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-[2/3] rounded-lg bg-border/30 animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 max-w-3xl mx-auto">
              {suggestions.map((book) => (
                <BookButton
                  key={book.id}
                  book={book}
                  isSelected={selected.has(book.id)}
                  onToggle={() => handleToggle(book)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {selected.size > 0 && selected.size < MIN_BOOKS && (
        <p className="text-center text-sm text-muted font-body">
          {MIN_BOOKS - selected.size} more to go — search for another favorite above
        </p>
      )}
      {selected.size >= MIN_BOOKS && (
        <p className="text-center text-sm text-muted font-body">
          Keep adding books for better recommendations, or hit Next
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
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
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
