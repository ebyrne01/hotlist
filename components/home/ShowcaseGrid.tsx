import Link from "next/link";
import BookCover from "@/components/ui/BookCover";
import Badge from "@/components/ui/Badge";
import { PepperRow } from "@/components/ui/PepperIcon";

export interface ShowcaseBook {
  id: string;
  slug: string;
  title: string;
  author: string;
  coverUrl: string | null;
  goodreadsRating: number | null;
  amazonRating: number | null;
  romanceIoRating: number | null;
  spiceLevel: number | null;
  tropes: string[];
}

function RatingPill({ label, value }: { label: string; value: number | null }) {
  if (!value) return null;
  return (
    <span className="text-[10px] font-mono uppercase tracking-wide text-muted-a11y whitespace-nowrap">
      <span className="text-gold">{value.toFixed(1)}</span> {label}
    </span>
  );
}

export default function ShowcaseGrid({ books }: { books: ShowcaseBook[] }) {
  if (books.length === 0) return null;
  const gridColumns =
    books.length >= 3
      ? "sm:grid-cols-2 lg:grid-cols-3"
      : books.length === 2
        ? "sm:grid-cols-2"
        : "grid-cols-1";

  return (
    <section className="py-12 sm:py-16">
      <div className="mb-6 sm:flex sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fire">
            The reading room
          </p>
          <h2 className="mt-1 font-display text-3xl sm:text-4xl font-bold text-ink leading-tight">
            Every clue, before you commit.
          </h2>
        </div>
        <p className="mt-2 max-w-sm text-sm font-body text-muted-a11y leading-relaxed sm:text-right">
          Cross-platform ratings, reader heat checks, and the tropes that make
          the decision easy.
        </p>
      </div>

      <div className={`grid grid-cols-1 gap-px overflow-hidden border-y border-aged-gold/30 bg-aged-gold/30 ${gridColumns}`}>
        {books.map((book, index) => {
          const isFeatured = index === 0 && books.length >= 4;
          return (
            <Link
              key={book.id}
              href={`/book/${book.slug}`}
              className={`group relative flex gap-4 bg-cream p-4 transition-colors hover:bg-parchment ${
                isFeatured ? "sm:col-span-2 lg:row-span-2 lg:flex-col lg:p-6" : ""
              }`}
            >
            {isFeatured && (
              <span className="absolute right-4 top-4 font-mono text-[9px] uppercase tracking-[0.18em] text-fire">
                Editor&apos;s first pick
              </span>
            )}
            <div className={`shrink-0 overflow-hidden shadow-md shadow-black/10 ${
              isFeatured ? "w-20 h-[120px] lg:h-[238px] lg:w-[158px]" : "w-16 h-24"
            }`}>
              <BookCover
                title={book.title}
                coverUrl={book.coverUrl}
                size="fill"
                className="w-full h-full object-cover"
              />
            </div>
            <div className={`min-w-0 flex-1 ${isFeatured ? "lg:flex lg:flex-col lg:justify-end" : ""}`}>
              <h3 className={`font-display font-bold text-ink leading-tight group-hover:text-oxblood transition-colors ${
                isFeatured ? "pr-20 text-lg lg:pr-0 lg:text-2xl" : "text-base"
              }`}>
                {book.title}
              </h3>
              <p className="text-xs font-body text-muted-a11y mt-0.5">
                {book.author}
              </p>

              {/* Ratings row */}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <RatingPill label="GR" value={book.goodreadsRating} />
                <RatingPill label="AMZ" value={book.amazonRating} />
                <RatingPill label="RIO" value={book.romanceIoRating} />
              </div>

              {/* Spice */}
              {book.spiceLevel && book.spiceLevel > 0 && (
                <div className="mt-1">
                  <PepperRow level={book.spiceLevel} size={12} />
                </div>
              )}

              {/* Trope pills */}
              {book.tropes.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {book.tropes.slice(0, isFeatured ? 3 : 2).map((trope) => (
                    <Badge key={trope} variant="muted" className="!text-[9px] !px-1.5 !py-0.5 !min-h-0">
                      {trope}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </Link>
          );
        })}
      </div>
    </section>
  );
}
