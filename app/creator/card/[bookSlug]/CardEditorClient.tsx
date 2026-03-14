"use client";

import { useState } from "react";
import Image from "next/image";

interface BookData {
  id: string;
  title: string;
  author: string;
  slug: string;
  coverUrl: string | null;
  goodreadsRating: number | null;
  amazonRating: number | null;
  spiceLevel: number;
  spiceSource: string | null;
  tropes: string[];
}

interface ExistingCard {
  id: string;
  spiceOverride: number | null;
  tropesSelected: string[];
  creatorQuote: string | null;
  aspectRatio: string;
}

interface Props {
  book: BookData;
  creatorHandle: string;
  existingCard: ExistingCard | null;
}

const HEAT_LABELS: Record<number, string> = {
  0: "",
  1: "Sweet",
  2: "Mild",
  3: "Steamy",
  4: "Spicy",
  5: "Scorching",
};

function PepperSvg({ filled, size = 28 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <path
        d="M8 1c1.5 2.5 4 4 4 7.5a4 4 0 0 1-8 0C4 5 6.5 3.5 8 1z"
        fill={filled ? "#D85A30" : undefined}
        className={filled ? "" : "fill-border-tertiary opacity-50"}
        style={filled ? undefined : { fill: "#c4b5a4", opacity: 0.35 }}
      />
    </svg>
  );
}

export default function CardEditorClient({ book, creatorHandle, existingCard }: Props) {
  const originalSpice = book.spiceLevel;
  const [spiceLevel, setSpiceLevel] = useState(
    existingCard?.spiceOverride ?? book.spiceLevel
  );
  const [isSpiceOverride, setIsSpiceOverride] = useState(
    existingCard?.spiceOverride != null && existingCard.spiceOverride !== originalSpice
  );
  const [selectedTropes, setSelectedTropes] = useState<string[]>(
    existingCard?.tropesSelected.length
      ? existingCard.tropesSelected
      : book.tropes.slice(0, 3)
  );
  const [creatorQuote, setCreatorQuote] = useState(
    existingCard?.creatorQuote ?? ""
  );
  const [aspectRatio, setAspectRatio] = useState<string>(
    existingCard?.aspectRatio ?? "9:16"
  );
  const [isSaving, setIsSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cardId, setCardId] = useState<string | null>(existingCard?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  function handleSpiceTap(level: number) {
    setSpiceLevel(level);
    setIsSpiceOverride(level !== originalSpice);
  }

  function handleTropeToggle(trope: string) {
    setSelectedTropes((prev) => {
      if (prev.includes(trope)) {
        return prev.filter((t) => t !== trope);
      }
      if (prev.length >= 4) {
        // Deselect the oldest, add new
        return [...prev.slice(1), trope];
      }
      return [...prev, trope];
    });
  }

  async function saveCard(): Promise<string | null> {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/creator/share-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: book.id,
          spiceOverride: isSpiceOverride ? spiceLevel : null,
          tropesSelected: selectedTropes,
          creatorQuote: creatorQuote.trim() || null,
          aspectRatio,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to save card");
        return null;
      }

      const data = await res.json();
      setCardId(data.cardId);
      return data.cardId;
    } catch {
      setError("Failed to save card");
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePreview() {
    const id = await saveCard();
    if (id) {
      // Add timestamp to bust cache
      setPreviewUrl(`/api/creator/share-card/${id}/preview?t=${Date.now()}`);
    }
  }

  async function handleExport() {
    const id = await saveCard();
    if (id) {
      // Open image in new tab (triggers download or display)
      window.open(`/api/creator/share-card/${id}/image`, "_blank");
    }
  }

  const spiceSourceLabel = isSpiceOverride
    ? `you rated ${spiceLevel}/5`
    : book.spiceSource === "romance_io"
      ? "from Romance.io"
      : book.spiceSource === "community"
        ? "from community"
        : book.spiceSource
          ? `from ${book.spiceSource.replace(/_/g, " ")}`
          : "no data yet";

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-cream/50 border border-border rounded-lg px-4 py-3">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 16 16">
            <path
              d="M8 1c1.5 2.5 4 4 4 7.5a4 4 0 0 1-8 0C4 5 6.5 3.5 8 1z"
              fill="#D85A30"
            />
          </svg>
          <span className="font-display text-lg font-semibold text-ink">
            Create share card
          </span>
        </div>
        <span className="font-mono text-sm text-muted">@{creatorHandle}</span>
      </div>

      {/* Book summary (read-only) */}
      <div className="flex gap-4 items-start">
        {book.coverUrl ? (
          <Image
            src={book.coverUrl}
            alt={book.title}
            width={80}
            height={120}
            className="rounded-lg object-cover"
          />
        ) : (
          <div className="w-[80px] h-[120px] rounded-lg bg-muted/10 flex items-center justify-center">
            <span className="text-xs text-muted italic text-center px-2">
              {book.title}
            </span>
          </div>
        )}
        <div>
          <h2 className="font-display text-xl font-bold text-ink leading-tight">
            {book.title}
          </h2>
          <p className="font-body text-sm text-muted mt-1">{book.author}</p>
          <div className="flex items-center gap-3 mt-2 text-xs font-mono text-muted">
            {book.goodreadsRating && (
              <span>GR {book.goodreadsRating.toFixed(1)}</span>
            )}
            {book.amazonRating && (
              <span>AMZ {book.amazonRating.toFixed(1)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Spice level editor */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-sm font-medium text-ink">
            Spice level
          </span>
          <span className="font-mono text-xs text-muted">{spiceSourceLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => handleSpiceTap(n)}
              className="p-1 rounded-md hover:bg-[#FFF5EE] transition-colors"
              aria-label={`Set spice to ${n}`}
            >
              <PepperSvg filled={n <= spiceLevel} />
            </button>
          ))}
          <span className="ml-3 text-sm font-body text-[#C88A5A]">
            {HEAT_LABELS[spiceLevel] ?? ""}
          </span>
          {isSpiceOverride && (
            <span className="ml-2 text-xs font-mono bg-fire/10 text-fire px-2 py-0.5 rounded-full">
              Your rating
            </span>
          )}
        </div>
        {isSpiceOverride && (
          <p className="text-xs font-body text-muted/70 mt-1.5 flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="text-muted/50">
              <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <text x="8" y="12" textAnchor="middle" fontSize="11" fill="currentColor">i</text>
            </svg>
            Your rating will help improve spice data for this book
          </p>
        )}
      </div>

      {/* Trope selector */}
      {book.tropes.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-sm font-medium text-ink">
              Tropes shown on card
            </span>
            <span className="font-mono text-xs text-muted">tap to toggle</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {book.tropes.map((trope) => {
              const active = selectedTropes.includes(trope);
              return (
                <button
                  key={trope}
                  type="button"
                  onClick={() => handleTropeToggle(trope)}
                  className={`px-3 py-1.5 rounded-full text-xs font-mono transition-colors border ${
                    active
                      ? "bg-[#F5EFE0] border-[#D4B87A] text-[#6B5A2E]"
                      : "bg-cream border-border text-muted hover:border-muted/40"
                  }`}
                >
                  {trope}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Creator quote */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-sm font-medium text-ink">
            Your take
          </span>
          <span className="font-mono text-xs text-muted">
            optional, 140 chars
          </span>
        </div>
        <textarea
          value={creatorQuote}
          onChange={(e) =>
            setCreatorQuote(e.target.value.slice(0, 140))
          }
          placeholder='e.g. "If you loved ACOTAR, this is your next obsession."'
          className="w-full px-3 py-2 rounded-lg border border-border bg-white font-body text-sm text-ink placeholder:text-muted/40 resize-none focus:outline-none focus:ring-2 focus:ring-fire/20 focus:border-fire/40"
          rows={3}
        />
        <div className="text-right mt-1">
          <span className="font-mono text-xs text-muted">
            {creatorQuote.length}/140
          </span>
        </div>
      </div>

      {/* Aspect ratio selector */}
      <div>
        <span className="font-mono text-sm font-medium text-ink block mb-2">
          Aspect ratio
        </span>
        <div className="flex gap-2">
          {[
            { value: "9:16", label: "9:16 Stories" },
            { value: "16:9", label: "16:9 Video" },
            { value: "1:1", label: "1:1 Feed" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setAspectRatio(opt.value)}
              className={`px-4 py-2 rounded-lg text-xs font-mono transition-colors border ${
                aspectRatio === opt.value
                  ? "bg-fire/10 border-fire/30 text-fire"
                  : "bg-cream border-border text-muted hover:border-muted/40"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <p className="text-sm font-body text-red-600 bg-red-50 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handlePreview}
          disabled={isSaving}
          className="flex-1 px-4 py-3 rounded-lg border border-border text-sm font-mono text-ink hover:bg-cream/80 transition-colors disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Preview card"}
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={isSaving}
          className="flex-1 px-4 py-3 rounded-lg bg-fire text-white text-sm font-mono hover:bg-fire/90 transition-colors disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Export for video"}
        </button>
      </div>

      {/* Preview image */}
      {previewUrl && (
        <div className="mt-4">
          <h3 className="font-mono text-sm font-medium text-ink mb-3">
            Preview
          </h3>
          <div className="flex justify-center bg-ink/5 rounded-lg p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Share card preview"
              className="rounded-lg shadow-lg max-w-full"
              style={{
                maxHeight: aspectRatio === "9:16" ? "500px" : "300px",
              }}
            />
          </div>
          {cardId && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs font-mono text-muted">Share page:</span>
              <a
                href={`/card/${cardId}`}
                className="text-xs font-mono text-fire hover:text-fire/80 underline"
              >
                myhotlist.app/card/{cardId?.slice(0, 8)}...
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
