"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import BookCover from "@/components/ui/BookCover";

/** Detect if a string looks like a video URL (TikTok, Instagram, YouTube, etc.) */
function isVideoUrl(text: string): boolean {
  const trimmed = text.trim();
  return /^https?:\/\/.*(tiktok\.com|instagram\.com|youtube\.com|youtu\.be|reels|shorts)/i.test(trimmed);
}

// API search result shape (lean — not the full BookDetail)
export interface SearchResult {
  id: string;
  goodreadsId: string;
  title: string;
  author: string;
  slug: string;
  coverUrl: string | null;
  seriesName: string | null;
  seriesPosition: number | null;
  averageRating: number | null;
  goodreadsRating: number | null;
  subgenre: string | null;
}

interface SearchBarProps {
  variant?: "hero" | "navbar";
  className?: string;
  /** HTML id for the input element (useful for external focus triggers) */
  inputId?: string;
  /** When provided, selecting a result calls this instead of navigating to book detail */
  onSelectBook?: (book: SearchResult) => void;
}

export default function SearchBar({ variant = "navbar", className, inputId, onSelectBook }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [noResults, setNoResults] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Debounced search
  useEffect(() => {
    if (query.length < 3) {
      setResults([]);
      setNoResults(false);
      setIsOpen(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/books/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        const books = data.books?.slice(0, 6) ?? [];
        setResults(books);
        setNoResults(books.length === 0);
        setIsOpen(true);
      } catch {
        setResults([]);
        setNoResults(true);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Update dropdown position when open
  useEffect(() => {
    if (!isOpen || !wrapperRef.current) return;
    function updatePosition() {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDropdownPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  // Close on outside click (account for portal dropdown being outside wrapperRef)
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      // Don't close if click is inside the search wrapper
      if (wrapperRef.current?.contains(target)) return;
      // Don't close if click is inside the portal dropdown
      const closest = (e.target as HTMLElement).closest?.("[data-search-dropdown]");
      if (closest) return;
      setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) return;
      setIsOpen(false);
      if (isVideoUrl(trimmed)) {
        router.push(`/booktok?url=${encodeURIComponent(trimmed)}`);
      } else {
        router.push(`/search?q=${encodeURIComponent(trimmed)}`);
      }
    },
    [query, router]
  );

  const handleSelect = useCallback(
    (book: SearchResult) => {
      setIsOpen(false);
      setQuery("");
      if (onSelectBook) {
        onSelectBook(book);
      } else {
        router.push(`/book/${book.slug}`);
      }
    },
    [router, onSelectBook]
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  }, []);

  const isHero = variant === "hero";

  return (
    <div ref={wrapperRef} className={clsx("relative w-full", className)}>
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <Search
            size={isHero ? 20 : 16}
            className={clsx(
              "absolute top-1/2 -translate-y-1/2 text-muted",
              isHero ? "left-4" : "left-3"
            )}
          />
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            placeholder="Search by title, author, or ISBN"
            value={query}
            onChange={(e) => {
              const val = e.target.value;
              setQuery(val);
              if (isVideoUrl(val)) {
                router.push(`/booktok?url=${encodeURIComponent(val.trim())}`);
                return;
              }
            }}
            onFocus={() => (results.length > 0 || noResults) && setIsOpen(true)}
            onKeyDown={handleKeyDown}
            className={clsx(
              "w-full font-body text-ink placeholder:text-muted/50 focus:outline-none transition-shadow",
              isHero
                ? "pl-12 pr-4 py-4 text-base bg-white border-2 border-white/20 rounded-xl shadow-lg focus:ring-4 focus:ring-fire/20 focus:border-fire/40"
                : "pl-9 pr-3 py-2 text-sm bg-white border border-border rounded-lg focus:ring-2 focus:ring-fire/30 focus:border-fire/40"
            )}
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setResults([]); setNoResults(false); setIsOpen(false); }}
              className={clsx(
                "absolute top-1/2 -translate-y-1/2 text-muted hover:text-ink",
                isHero ? "right-4" : "right-3"
              )}
            >
              <X size={isHero ? 18 : 14} />
            </button>
          )}
        </div>
      </form>

      {/* Dropdown results — rendered via portal to avoid overflow clipping */}
      {isOpen && (results.length > 0 || loading || noResults) && dropdownPos &&
        createPortal(
          <div
            data-search-dropdown
            style={{
              position: "absolute",
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
              zIndex: 9999,
            }}
            className="bg-white border border-border rounded-lg shadow-xl overflow-hidden"
          >
            {loading && results.length === 0 && (
              <div className="px-4 py-3 text-sm font-body text-muted">Searching...</div>
            )}

            {/* No results state */}
            {noResults && !loading && (
              <div className="px-4 py-4">
                <p className="text-sm font-body text-muted">
                  No results for &ldquo;{query}&rdquo;
                </p>
                <div className="flex flex-col gap-1 mt-1">
                  <a
                    href="/tropes"
                    className="text-xs font-mono text-fire hover:underline inline-block"
                    onClick={() => setIsOpen(false)}
                  >
                    Browse by trope instead &rarr;
                  </a>
                  <a
                    href="/booktok"
                    className="text-xs font-mono text-fire hover:underline inline-block"
                    onClick={() => setIsOpen(false)}
                  >
                    📹 Or paste a BookTok link &rarr;
                  </a>
                </div>
              </div>
            )}

            {results.map((book) => (
              <button
                key={book.id}
                onClick={() => handleSelect(book)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-cream transition-colors text-left"
              >
                <BookCover title={book.title} coverUrl={book.coverUrl} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-display font-bold text-ink truncate">
                    {book.title}
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-mono text-muted truncate">{book.author}</p>
                    {book.seriesName && (
                      <span className="text-xs font-body text-muted/60 truncate">
                        Book {book.seriesPosition ?? "?"} of {book.seriesName}
                      </span>
                    )}
                  </div>
                  {book.subgenre && (
                    <span className="text-[10px] font-mono text-fire/70 bg-fire/5 px-1.5 py-0.5 rounded mt-0.5 inline-block">
                      {book.subgenre}
                    </span>
                  )}
                </div>
                {book.goodreadsRating && (
                  <span className="text-xs font-mono shrink-0 flex items-center gap-1">
                    <span className="text-muted/60">GR</span>
                    <span className="text-gold font-medium">{book.goodreadsRating.toFixed(1)}</span>
                  </span>
                )}
              </button>
            ))}

            {query.trim() && (
              <button
                onClick={() => { setIsOpen(false); router.push(`/search?q=${encodeURIComponent(query)}`); }}
                className="w-full px-4 py-2.5 text-xs font-mono text-fire hover:bg-cream transition-colors text-left border-t border-border"
              >
                See all results for &ldquo;{query}&rdquo; &rarr;
              </button>
            )}
          </div>,
          document.body
        )
      }
    </div>
  );
}
