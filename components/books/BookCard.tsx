"use client";

import Link from "next/link";
import { clsx } from "clsx";
import BookCover from "@/components/ui/BookCover";
import Badge from "@/components/ui/Badge";
import SpiceIndicator from "@/components/ui/SpiceIndicator";
import type { BookDetail } from "@/lib/types";

interface BookCardProps {
  book: BookDetail;
  layout?: "grid" | "list";
  className?: string;
}

function getAverageRating(book: BookDetail): number | null {
  const rated = book.ratings.filter((r) => r.rating !== null);
  if (rated.length === 0) return null;
  return rated.reduce((sum, r) => sum + (r.rating ?? 0), 0) / rated.length;
}

function getSpice(book: BookDetail) {
  if (book.spice.length === 0) return null;
  // Prefer community ratings over inferred
  const community = book.spice.find((s) => s.source === "hotlist_community");
  if (community) return community;
  return book.spice[0];
}

export default function BookCard({ book, layout = "grid", className }: BookCardProps) {
  const avg = getAverageRating(book);
  const spice = getSpice(book);
  const topTropes = book.tropes.slice(0, 2);
  const slug = book.slug || book.id;

  if (layout === "list") {
    return (
      <Link
        href={`/book/${slug}`}
        className={clsx(
          "flex gap-3 rounded-lg border border-border bg-white p-3 hover:shadow-md hover:border-fire/30 transition-all",
          className
        )}
      >
        <BookCover title={book.title} coverUrl={book.coverUrl} size="md" />
        <div className="flex flex-col gap-1 flex-1 min-w-0 py-0.5">
          <h3 className="font-display font-bold text-ink text-sm leading-tight truncate">
            {book.title}
          </h3>
          <p className="text-xs font-body text-muted truncate">{book.author}</p>
          <div className="flex items-center gap-2 mt-auto">
            {avg !== null && (
              <span className="text-xs font-mono text-gold font-medium">
                {avg.toFixed(1)}
              </span>
            )}
            {spice && (
              <SpiceIndicator
                level={spice.spiceLevel}
                source={spice.source}
                confidence={spice.confidence}
                ratingCount={spice.ratingCount}
              />
            )}
          </div>
          {topTropes.length > 0 && (
            <div className="flex gap-1 mt-1">
              {topTropes.map((t) => (
                <Badge key={t.id} variant="trope">
                  {t.name}
                </Badge>
              ))}
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
        "group flex flex-col rounded-lg border border-border bg-white hover:shadow-md hover:border-fire/30 transition-all w-[160px] sm:w-[180px] shrink-0",
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
        <h3 className="font-display font-bold text-ink text-xs leading-tight break-words">
          {book.title}
        </h3>
        <p className="text-[11px] font-body text-muted truncate">{book.author}</p>
        <div className="flex items-center gap-1.5 mt-1">
          {avg !== null && (
            <span className="text-[11px] font-mono text-gold font-medium">
              {avg.toFixed(1)}
            </span>
          )}
          {spice && (
            <SpiceIndicator
              level={spice.spiceLevel}
              source={spice.source}
              confidence={spice.confidence}
              ratingCount={spice.ratingCount}
              className="[&_span]:text-xs"
            />
          )}
        </div>
        {topTropes.length > 0 && (
          <div className="flex gap-1 mt-0.5 flex-wrap">
            {topTropes.map((t) => (
              <Badge key={t.id} variant="trope" className="text-[9px] px-1.5 py-0">
                {t.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
