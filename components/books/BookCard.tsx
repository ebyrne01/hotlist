"use client";

import Link from "next/link";
import { clsx } from "clsx";
import BookCover from "@/components/ui/BookCover";
import Badge from "@/components/ui/Badge";
import SpiceDisplay from "@/components/books/SpiceDisplay";
import SpiceIndicator from "@/components/ui/SpiceIndicator";
import { PepperRow } from "@/components/ui/PepperIcon";
import type { BookDetail } from "@/lib/types";

interface BookCardProps {
  book: BookDetail;
  layout?: "grid" | "list";
  className?: string;
}

function getRatingBySource(book: BookDetail, source: string): number | null {
  const r = book.ratings.find((r) => r.source === source);
  return r?.rating ?? null;
}

function getSpice(book: BookDetail) {
  if (book.spice.length === 0) return null;
  // Prefer community ratings over inferred
  const community = book.spice.find((s) => s.source === "hotlist_community");
  if (community) return community;
  return book.spice[0];
}

export default function BookCard({ book, layout = "grid", className }: BookCardProps) {
  const grRating = getRatingBySource(book, "goodreads");
  const amzRating = getRatingBySource(book, "amazon");
  const spice = getSpice(book);
  const topTropes = book.tropes.slice(0, 2);
  const tropeOverflow = book.tropes.length - 2;
  const slug = book.slug || book.id;

  if (layout === "list") {
    return (
      <Link
        href={`/book/${slug}`}
        className={clsx(
          "flex gap-3 rounded-lg border border-border bg-white p-3 hover:shadow-md hover:border-fire/30 transition-all overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fire",
          className
        )}
      >
        <BookCover title={book.title} coverUrl={book.coverUrl} size="md" />
        <div className="flex flex-col gap-1 flex-1 min-w-0 py-0.5">
          <h3 className="font-display font-bold text-ink text-sm leading-tight truncate">
            {book.title}
          </h3>
          <p className="text-xs font-body text-muted truncate">{book.author}</p>
          <div className="flex items-center gap-3 mt-auto">
            {grRating !== null && (
              <span className="text-xs font-mono">
                <span className="text-muted">GR</span>{" "}
                <span className="text-gold font-medium">{grRating.toFixed(1)}</span>
              </span>
            )}
            {amzRating !== null && (
              <span className="text-xs font-mono">
                <span className="text-muted">AMZ</span>{" "}
                <span className="text-gold font-medium">{amzRating.toFixed(1)}</span>
              </span>
            )}
            {book.compositeSpice ? (
              <SpiceDisplay
                composite={book.compositeSpice}
                compact
                showNudge
                bookSlug={slug}
                romanceIoSlug={book.romanceIoSlug}
              />
            ) : spice ? (
              <SpiceIndicator
                level={spice.spiceLevel}
                source={spice.source}
                confidence={spice.confidence}
                ratingCount={spice.ratingCount}
              />
            ) : null}
          </div>
          {topTropes.length > 0 && (
            <div className="flex items-center gap-1 mt-1 overflow-hidden">
              {topTropes.map((t) => (
                <Badge key={t.id} variant="trope" className="shrink-0">
                  {t.name}
                </Badge>
              ))}
              {tropeOverflow > 0 && (
                <span className="text-xs font-mono text-muted/60 shrink-0">+{tropeOverflow}</span>
              )}
            </div>
          )}
        </div>
      </Link>
    );
  }

  // Grid layout (vertical card)
  return (
    <Link
      href={`/book/${slug}`}
      className={clsx(
        "group flex flex-col rounded-lg border border-border bg-white hover:shadow-md hover:border-fire/30 transition-all w-[160px] sm:w-[180px] shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fire",
        className
      )}
    >
      <div className="relative w-full aspect-[2/3] bg-cream overflow-hidden rounded-t-lg">
        <BookCover
          title={book.title}
          coverUrl={book.coverUrl}
          size="fill"
          className="w-full h-full object-contain !rounded-none"
        />
      </div>
      <div className="p-2.5 flex flex-col gap-1">
        <h3 className="font-display font-bold text-ink text-sm leading-tight break-words">
          {book.title}
        </h3>
        <p className="text-xs font-body text-muted truncate">{book.author}</p>
        {/* Ratings — always rendered */}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs font-mono">
            <span className="text-muted">GR</span>{" "}
            {grRating !== null ? (
              <span className="text-gold font-medium">{grRating.toFixed(1)}</span>
            ) : (
              <span className="text-muted/40">&mdash;</span>
            )}
          </span>
          {amzRating !== null && (
            <span className="text-xs font-mono">
              <span className="text-muted">AMZ</span>{" "}
              <span className="text-gold font-medium">{amzRating.toFixed(1)}</span>
            </span>
          )}
        </div>
        {/* Spice — always rendered */}
        <div className="mt-0.5">
          {book.compositeSpice ? (
            <SpiceDisplay
              composite={book.compositeSpice}
              compact
              romanceIoSlug={book.romanceIoSlug}
              className="[&_span]:text-xs"
            />
          ) : spice ? (
            <SpiceIndicator
              level={spice.spiceLevel}
              source={spice.source}
              confidence={spice.confidence}
              ratingCount={spice.ratingCount}
              className="[&_span]:text-xs"
            />
          ) : (
            <PepperRow level={0} size={14} muted className="opacity-50" />
          )}
        </div>
        {topTropes.length > 0 && (
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {topTropes.map((t) => (
              <Badge key={t.id} variant="trope" className="text-xs px-1.5 py-0.5">
                {t.name}
              </Badge>
            ))}
            {tropeOverflow > 0 && (
              <span className="text-xs font-mono text-muted/60">+{tropeOverflow}</span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
