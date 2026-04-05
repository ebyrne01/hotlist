"use client";

import { useState, useEffect, useRef } from "react";
import { clsx } from "clsx";
import BookCover from "@/components/ui/BookCover";

interface CandidateBook {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  tropes: string[];
}

interface DislikedBooksStepProps {
  lovedIds: Set<string>;
  selected: Set<string>;
  onToggle: (bookId: string) => void;
  subgenres: Set<string>;
}

export default function DislikedBooksStep({
  lovedIds,
  selected,
  onToggle,
  subgenres,
}: DislikedBooksStepProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CandidateBook[]>([]);
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<CandidateBook[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

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

  // Fetch suggestions (exclude loved books)
  useEffect(() => {
    if (lovedIds.size === 0) return;

    const controller = new AbortController();
    setLoadingSuggestions(true);

    const pickedParam = Array.from(lovedIds).join(",");
    const subgenreParam = Array.from(subgenres).join(",");
    const url = `/api/reading-dna/suggestions?picked=${encodeURIComponent(pickedParam)}${subgenreParam ? `&subgenres=${encodeURIComponent(subgenreParam)}` : ""}`;

    fetch(url, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { books: [] }))
      .then((data) => setSuggestions(data.books ?? []))
      .catch(() => {})
      .finally(() => setLoadingSuggestions(false));

    return () => controller.abort();
  }, [lovedIds, subgenres]);

  // Exclude loved books from results
  const excludeIds = new Set(Array.from(lovedIds));
  const filteredSearch = searchResults.filter(
    (b) => !excludeIds.has(b.id)
  );
  const filteredSuggestions = suggestions.filter(
    (b) => !excludeIds.has(b.id) && !selected.has(b.id)
  );

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold text-ink">
          Any books that weren&apos;t for you?
        </h2>
        <p className="text-sm font-body text-muted mt-2">
          This helps us avoid recommending similar ones. Skip if nothing comes
          to mind.
        </p>
        {selected.size > 0 && (
          <p className="text-sm font-mono text-muted/70 mt-1">
            {selected.size} selected
          </p>
        )}
      </div>

      {/* Search input */}
      <div className="max-w-sm mx-auto">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Try a book you didn't finish..."
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
              <DislikeButton
                key={book.id}
                book={book}
                isSelected={selected.has(book.id)}
                onToggle={onToggle}
              />
            ))}
          </div>
        </div>
      )}

      {/* Suggestion grid */}
      {(filteredSuggestions.length > 0 || loadingSuggestions) && (
        <div>
          <p className="text-xs font-mono text-muted uppercase tracking-wide mb-2 px-1">
            Popular books — any misses?
          </p>
          {loadingSuggestions && filteredSuggestions.length === 0 ? (
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
              {filteredSuggestions.map((book) => (
                <DislikeButton
                  key={book.id}
                  book={book}
                  isSelected={selected.has(book.id)}
                  onToggle={onToggle}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DislikeButton({
  book,
  isSelected,
  onToggle,
}: {
  book: { id: string; title: string; author: string; coverUrl: string | null };
  isSelected: boolean;
  onToggle: (bookId: string) => void;
}) {
  return (
    <button
      onClick={() => onToggle(book.id)}
      className={clsx(
        "relative rounded-lg overflow-hidden transition-all",
        isSelected
          ? "ring-3 ring-muted/50 scale-[1.02] opacity-75"
          : "hover:scale-[1.02] hover:ring-2 hover:ring-muted/30"
      )}
      title={`${book.title} by ${book.author}`}
    >
      <BookCover title={book.title} coverUrl={book.coverUrl} size="md" />
      {isSelected && (
        <div className="absolute inset-0 bg-ink/20 flex items-center justify-center">
          <span className="bg-muted text-white rounded-full w-7 h-7 flex items-center justify-center text-sm font-bold shadow-md">
            &times;
          </span>
        </div>
      )}
    </button>
  );
}
