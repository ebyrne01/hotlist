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
    <span className="text-[11px] font-mono text-muted whitespace-nowrap">
      {value.toFixed(1)} {label}
    </span>
  );
}

export default function ShowcaseGrid({ books }: { books: ShowcaseBook[] }) {
  if (books.length === 0) return null;

  return (
    <section className="py-8">
      <h2 className="font-display text-xl sm:text-2xl font-bold text-ink text-center mb-1">
        See what Hotlist knows
      </h2>
      <p className="text-sm font-body text-muted text-center mb-6">
        Cross-platform ratings, spice levels, and tropes — all in one place
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {books.map((book) => (
          <Link
            key={book.id}
            href={`/book/${book.slug}`}
            className="flex gap-3 p-3 bg-white border border-border rounded-lg hover:border-muted/40 transition-colors"
          >
            <div className="w-14 h-[84px] shrink-0 overflow-hidden">
              <BookCover
                title={book.title}
                coverUrl={book.coverUrl}
                size="sm"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-sm font-bold text-ink leading-tight truncate">
                {book.title}
              </h3>
              <p className="text-xs font-body text-muted mt-0.5">
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
                  {book.tropes.slice(0, 3).map((trope) => (
                    <Badge key={trope} variant="muted" className="!text-[10px] !px-1.5 !py-0 !min-h-0">
                      {trope}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
