"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useSignInModal } from "@/lib/auth/useSignInModal";

type Step = "upload" | "matching" | "review" | "applying" | "done";

interface MatchedBook {
  importIndex: number;
  bookId: string | null;
  title: string;
  author: string;
  coverUrl: string | null;
  matchMethod: string;
  proposedResponse: string;
  shelf: string;
  rating: number | null;
}

const RESPONSE_LABELS: Record<string, { label: string; emoji: string }> = {
  must_read: { label: "Must Read", emoji: "🔥" },
  on_the_shelf: { label: "Shelf", emoji: "📚" },
  not_for_me: { label: "Pass", emoji: "🤷" },
  loved_it: { label: "Loved It", emoji: "❤️" },
  it_was_fine: { label: "Fine", emoji: "👍" },
  didnt_finish: { label: "DNF", emoji: "💬" },
};

export default function GoodreadsImporter() {
  const router = useRouter();
  const { user } = useAuth();
  const { openSignIn } = useSignInModal();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState<string | null>(null);
  const [books, setBooks] = useState<MatchedBook[]>([]);
  const [responses, setResponses] = useState<Record<number, string>>({});
  const [stats, setStats] = useState({ total: 0, matched: 0, unmatched: 0 });
  const [resultHotlistId, setResultHotlistId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!user) {
        openSignIn(() => handleFile(file));
        return;
      }

      setError(null);
      setStep("matching");

      try {
        const csvText = await file.text();
        const res = await fetch("/api/get-started/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "match", csvText }),
        });

        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? "Failed to process CSV");
          setStep("upload");
          return;
        }

        const data = await res.json();
        setBooks(data.books);
        setStats({
          total: data.totalImported,
          matched: data.matched,
          unmatched: data.unmatched,
        });

        // Pre-fill proposed responses
        const initial: Record<number, string> = {};
        for (const book of data.books as MatchedBook[]) {
          if (book.bookId) {
            initial[book.importIndex] = book.proposedResponse;
          }
        }
        setResponses(initial);
        setStep("review");
      } catch {
        setError("Failed to parse CSV. Please try again.");
        setStep("upload");
      }
    },
    [user, openSignIn]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith(".csv") || file.type === "text/csv")) {
        handleFile(file);
      } else {
        setError("Please upload a CSV file");
      }
    },
    [handleFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  async function handleApply() {
    setStep("applying");
    setError(null);

    const toApply = Object.entries(responses)
      .map(([idx, response]) => {
        const book = books.find((b) => b.importIndex === parseInt(idx));
        if (!book?.bookId) return null;
        return { bookId: book.bookId, response };
      })
      .filter((r): r is { bookId: string; response: string } => r !== null);

    if (toApply.length === 0) {
      setError("No matched books to import");
      setStep("review");
      return;
    }

    try {
      const res = await fetch("/api/get-started/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", responses: toApply }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to apply import");
        setStep("review");
        return;
      }

      const data = await res.json();
      setResultHotlistId(data.hotlistId);
      setStep("done");
    } catch {
      setError("Something went wrong. Please try again.");
      setStep("review");
    }
  }

  // Upload step
  if (step === "upload") {
    return (
      <div>
        <div className="bg-cream/50 border border-border rounded-lg p-5 mb-6">
          <h3 className="text-sm font-mono font-semibold text-ink mb-2">
            How to export from Goodreads
          </h3>
          <ol className="text-xs font-body text-muted space-y-1.5 list-decimal list-inside">
            <li>
              Go to{" "}
              <span className="font-mono text-ink">
                My Books → Import and Export
              </span>
            </li>
            <li>Click &ldquo;Export Library&rdquo;</li>
            <li>Download the CSV file and upload it below</li>
          </ol>
        </div>

        <div
          className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${
            isDragging
              ? "border-fire bg-fire/5"
              : "border-border hover:border-fire/30"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="text-3xl mb-3">📄</div>
          <p className="text-sm font-mono text-ink mb-1">
            Drop your Goodreads CSV here
          </p>
          <p className="text-xs font-mono text-muted">
            or click to browse files
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileInput}
            className="hidden"
          />
        </div>

        {error && (
          <p className="mt-4 text-sm font-mono text-red-600 text-center">
            {error}
          </p>
        )}
      </div>
    );
  }

  // Matching step
  if (step === "matching") {
    return (
      <div className="text-center py-16">
        <div className="inline-block w-8 h-8 border-2 border-fire border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-mono text-muted">
          Matching your books against our database...
        </p>
      </div>
    );
  }

  // Applying step
  if (step === "applying") {
    return (
      <div className="text-center py-16">
        <div className="inline-block w-8 h-8 border-2 border-fire border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-mono text-muted">
          Importing {Object.keys(responses).length} books...
        </p>
      </div>
    );
  }

  // Done step
  if (step === "done") {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-4">🎉</div>
        <h2 className="font-display text-2xl font-bold text-ink mb-2">
          Import Complete!
        </h2>
        <p className="text-sm font-body text-muted mb-6">
          {Object.keys(responses).length} books imported to your reading profile.
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

  // Review step
  const matchedBooks = books.filter((b) => b.bookId !== null);
  const unmatchedBooks = books.filter((b) => b.bookId === null);
  const selectedCount = Object.keys(responses).length;

  return (
    <div>
      {/* Stats bar */}
      <div className="flex items-center gap-4 mb-6 px-4 py-3 bg-cream/50 border border-border rounded-lg">
        <div className="text-center flex-1">
          <p className="text-lg font-mono font-bold text-ink">{stats.total}</p>
          <p className="text-xs font-mono text-muted">in CSV</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div className="text-center flex-1">
          <p className="text-lg font-mono font-bold text-fire">{stats.matched}</p>
          <p className="text-xs font-mono text-muted">matched</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div className="text-center flex-1">
          <p className="text-lg font-mono font-bold text-muted">{stats.unmatched}</p>
          <p className="text-xs font-mono text-muted">not found</p>
        </div>
      </div>

      {error && (
        <p className="mb-4 text-sm font-mono text-red-600 text-center">
          {error}
        </p>
      )}

      {/* Matched books */}
      {matchedBooks.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-mono font-semibold text-ink mb-3">
            Matched Books ({matchedBooks.length})
          </h3>
          <div className="space-y-2">
            {matchedBooks.map((book) => (
              <div
                key={book.importIndex}
                className="flex items-center gap-3 px-3 py-2 border border-border rounded-lg"
              >
                {/* Cover */}
                {book.coverUrl ? (
                  <img
                    src={book.coverUrl}
                    alt=""
                    className="w-8 h-12 rounded object-cover shrink-0"
                  />
                ) : (
                  <div className="w-8 h-12 rounded bg-border shrink-0" />
                )}

                {/* Title + author */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-body text-ink truncate">
                    {book.title}
                  </p>
                  <p className="text-xs font-mono text-muted truncate">
                    {book.author}
                    {book.rating && (
                      <span className="ml-2">
                        {"⭐".repeat(book.rating)}
                      </span>
                    )}
                  </p>
                </div>

                {/* Response selector */}
                <select
                  value={responses[book.importIndex] ?? ""}
                  onChange={(e) =>
                    setResponses((prev) => ({
                      ...prev,
                      [book.importIndex]: e.target.value,
                    }))
                  }
                  className="text-xs font-mono bg-cream border border-border rounded px-2 py-1 text-ink shrink-0"
                >
                  {Object.entries(RESPONSE_LABELS).map(([key, { label, emoji }]) => (
                    <option key={key} value={key}>
                      {emoji} {label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unmatched books (collapsed) */}
      {unmatchedBooks.length > 0 && (
        <details className="mb-6">
          <summary className="text-sm font-mono text-muted cursor-pointer hover:text-ink transition-colors">
            {unmatchedBooks.length} books not found in our database
          </summary>
          <div className="mt-2 space-y-1 pl-4">
            {unmatchedBooks.map((book) => (
              <p
                key={book.importIndex}
                className="text-xs font-body text-muted"
              >
                {book.title} — {book.author}
              </p>
            ))}
          </div>
        </details>
      )}

      {/* Apply button */}
      <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-border -mx-4 px-4 py-4">
        <button
          onClick={handleApply}
          disabled={selectedCount === 0}
          className="w-full py-3 bg-fire text-white text-sm font-mono rounded-lg hover:bg-fire/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Import {selectedCount} book{selectedCount !== 1 ? "s" : ""}
        </button>
      </div>
    </div>
  );
}
