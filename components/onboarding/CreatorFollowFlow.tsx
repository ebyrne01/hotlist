"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSignInModal } from "@/lib/auth/useSignInModal";

type Step = "search" | "loading-books" | "rate" | "applying" | "done";

interface Creator {
  id: string;
  handle: string;
  platform: string;
  bookCount: number;
}

interface CreatorBook {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  overlapCount: number;
}

const RESPONSE_LABELS: Record<string, { label: string; emoji: string }> = {
  must_read: { label: "Must Read", emoji: "🔥" },
  on_the_shelf: { label: "Shelf", emoji: "📚" },
  not_for_me: { label: "Pass", emoji: "🤷" },
};

const PLATFORM_ICONS: Record<string, string> = {
  tiktok: "📱",
  instagram: "📸",
  youtube: "🎬",
};

export default function CreatorFollowFlow() {
  const router = useRouter();
  const { user } = useAuth();
  const { openSignIn } = useSignInModal();

  const [step, setStep] = useState<Step>("search");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Creator[]>([]);
  const [selectedCreators, setSelectedCreators] = useState<Map<string, Creator>>(new Map());
  const [books, setBooks] = useState<CreatorBook[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [resultHotlistId, setResultHotlistId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch("/api/get-started/creators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search", query: query.trim() }),
      });
      const data = await res.json();
      setSearchResults(data.creators ?? []);
    } catch {
      // Silently fail — user can retry
    } finally {
      setSearching(false);
    }
  }, [query]);

  function toggleCreator(creator: Creator) {
    setSelectedCreators((prev) => {
      const next = new Map(prev);
      if (next.has(creator.id)) {
        next.delete(creator.id);
      } else {
        next.set(creator.id, creator);
      }
      return next;
    });
  }

  async function handleLoadBooks() {
    const creatorIds = Array.from(selectedCreators.keys());
    if (creatorIds.length === 0) return;

    setStep("loading-books");
    try {
      const res = await fetch("/api/get-started/creators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "books", creatorIds }),
      });
      const data = await res.json();
      setBooks(data.books ?? []);
      setStep("rate");
    } catch {
      setStep("search");
    }
  }

  async function handleApply() {
    if (!user) {
      openSignIn(() => handleApply());
      return;
    }

    setStep("applying");
    const creatorIds = Array.from(selectedCreators.keys());
    const toApply = Object.entries(responses).map(([bookId, response]) => ({
      bookId,
      response,
    }));

    try {
      const res = await fetch("/api/get-started/creators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          creatorIds,
          responses: toApply,
        }),
      });
      const data = await res.json();
      setResultHotlistId(data.hotlistId ?? null);
      setStep("done");
    } catch {
      setStep("rate");
    }
  }

  // Search step
  if (step === "search") {
    return (
      <div>
        {/* Search bar */}
        <div className="flex gap-2 mb-6">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search by handle (e.g. @aaborrego)"
            className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-mono text-ink bg-white focus:outline-none focus:border-fire/50 placeholder:text-muted/50"
          />
          <button
            onClick={handleSearch}
            disabled={searching || !query.trim()}
            className="px-4 py-2.5 bg-fire text-white text-sm font-mono rounded-lg hover:bg-fire/90 transition-colors disabled:opacity-40"
          >
            {searching ? "..." : "Search"}
          </button>
        </div>

        {/* Search results */}
        {searchResults.length > 0 && (
          <div className="space-y-2 mb-6">
            {searchResults.map((creator) => {
              const isSelected = selectedCreators.has(creator.id);
              return (
                <button
                  key={creator.id}
                  onClick={() => toggleCreator(creator)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors text-left ${
                    isSelected
                      ? "border-fire bg-fire/5"
                      : "border-border hover:border-fire/30"
                  }`}
                >
                  <span className="text-lg">
                    {PLATFORM_ICONS[creator.platform] ?? "📱"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono text-ink">
                      @{creator.handle}
                    </p>
                    <p className="text-xs font-mono text-muted">
                      {creator.bookCount} book{creator.bookCount !== 1 ? "s" : ""} recommended
                    </p>
                  </div>
                  {isSelected && (
                    <span className="text-fire text-sm">✓</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {searchResults.length === 0 && query && !searching && (
          <p className="text-sm font-mono text-muted text-center mb-6">
            No creators found. Try a different search.
          </p>
        )}

        {/* Selected creators */}
        {selectedCreators.size > 0 && (
          <div className="mb-6">
            <p className="text-xs font-mono text-muted mb-2">
              Selected ({selectedCreators.size}):
            </p>
            <div className="flex flex-wrap gap-2">
              {Array.from(selectedCreators.values()).map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1 text-xs font-mono px-2.5 py-1 rounded-full bg-fire/10 text-fire"
                >
                  @{c.handle}
                  <button
                    onClick={() => toggleCreator(c)}
                    className="hover:text-fire/60"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Continue button */}
        {selectedCreators.size >= 1 && (
          <button
            onClick={handleLoadBooks}
            className="w-full py-3 bg-fire text-white text-sm font-mono rounded-lg hover:bg-fire/90 transition-colors"
          >
            See their top picks →
          </button>
        )}
      </div>
    );
  }

  // Loading books
  if (step === "loading-books") {
    return (
      <div className="text-center py-16">
        <div className="inline-block w-8 h-8 border-2 border-fire border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-mono text-muted">
          Finding books from {selectedCreators.size} creator{selectedCreators.size !== 1 ? "s" : ""}...
        </p>
      </div>
    );
  }

  // Applying
  if (step === "applying") {
    return (
      <div className="text-center py-16">
        <div className="inline-block w-8 h-8 border-2 border-fire border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-mono text-muted">
          Following creators and saving your picks...
        </p>
      </div>
    );
  }

  // Done
  if (step === "done") {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-4">🎉</div>
        <h2 className="font-display text-2xl font-bold text-ink mb-2">
          You&apos;re Following {selectedCreators.size} Creator{selectedCreators.size !== 1 ? "s" : ""}!
        </h2>
        <p className="text-sm font-body text-muted mb-6">
          {Object.keys(responses).length} books added to your reading profile.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {resultHotlistId && (
            <button
              onClick={() => router.push(`/lists/${resultHotlistId}`)}
              className="px-5 py-2.5 bg-fire text-white text-sm font-mono rounded-lg hover:bg-fire/90 transition-colors"
            >
              View your Hotlist
            </button>
          )}
          <button
            onClick={() => router.push("/get-started/rate")}
            className="px-5 py-2.5 border border-border text-sm font-mono text-ink rounded-lg hover:border-fire/30 transition-colors"
          >
            Rate more books
          </button>
        </div>
      </div>
    );
  }

  // Rate step — show creator's top books
  const ratedCount = Object.keys(responses).length;

  return (
    <div>
      <p className="text-sm font-mono text-muted mb-4">
        {books.length} books from your selected creators. Rate them to build your profile:
      </p>

      {books.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm font-body text-muted mb-4">
            No books found from these creators yet.
          </p>
          <button
            onClick={() => setStep("search")}
            className="text-sm font-mono text-fire hover:text-fire/80 transition-colors"
          >
            ← Pick different creators
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            {books.map((book) => {
              const currentResponse = responses[book.id];
              return (
                <div
                  key={book.id}
                  className="border border-border rounded-lg p-3 flex flex-col"
                >
                  {/* Cover */}
                  {book.coverUrl ? (
                    <img
                      src={book.coverUrl}
                      alt=""
                      className="w-full aspect-[2/3] rounded object-cover mb-2"
                    />
                  ) : (
                    <div className="w-full aspect-[2/3] rounded bg-border mb-2" />
                  )}

                  {/* Title */}
                  <p className="text-xs font-body text-ink line-clamp-2 mb-1">
                    {book.title}
                  </p>
                  <p className="text-[10px] font-mono text-muted truncate mb-2">
                    {book.author}
                  </p>

                  {/* Response buttons */}
                  <div className="flex gap-1 mt-auto">
                    {Object.entries(RESPONSE_LABELS).map(([key, { emoji }]) => (
                      <button
                        key={key}
                        onClick={() =>
                          setResponses((prev) => {
                            if (prev[book.id] === key) {
                              const next = { ...prev };
                              delete next[book.id];
                              return next;
                            }
                            return { ...prev, [book.id]: key };
                          })
                        }
                        className={`flex-1 py-1.5 text-sm rounded transition-colors ${
                          currentResponse === key
                            ? "bg-fire/15 ring-1 ring-fire"
                            : "bg-cream hover:bg-fire/5"
                        }`}
                        title={RESPONSE_LABELS[key].label}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Apply button */}
          <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-border -mx-4 px-4 py-4">
            <button
              onClick={handleApply}
              disabled={ratedCount === 0}
              className="w-full py-3 bg-fire text-white text-sm font-mono rounded-lg hover:bg-fire/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {ratedCount === 0
                ? "Rate at least 1 book to continue"
                : `Save ${ratedCount} pick${ratedCount !== 1 ? "s" : ""} & follow creators`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
