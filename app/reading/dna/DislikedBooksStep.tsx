"use client";

import { clsx } from "clsx";
import BookCover from "@/components/ui/BookCover";

interface CandidateBook {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
}

interface DislikedBooksStepProps {
  books: CandidateBook[];
  lovedIds: Set<string>;
  selected: Set<string>;
  onToggle: (bookId: string) => void;
}

export default function DislikedBooksStep({
  books,
  lovedIds,
  selected,
  onToggle,
}: DislikedBooksStepProps) {
  // Exclude books the user already picked as loved
  const availableBooks = books.filter((b) => !lovedIds.has(b.id));

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

      {availableBooks.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 max-w-3xl mx-auto">
          {availableBooks.map((book) => {
            const isSelected = selected.has(book.id);
            return (
              <button
                key={book.id}
                onClick={() => onToggle(book.id)}
                className={clsx(
                  "relative rounded-lg overflow-hidden transition-all",
                  isSelected
                    ? "ring-3 ring-muted/50 scale-[1.02] opacity-75"
                    : "hover:scale-[1.02] hover:ring-2 hover:ring-muted/30"
                )}
                title={`${book.title} by ${book.author}`}
              >
                <BookCover
                  title={book.title}
                  coverUrl={book.coverUrl}
                  size="md"
                />
                {isSelected && (
                  <div className="absolute inset-0 bg-ink/20 flex items-center justify-center">
                    <span className="bg-muted text-white rounded-full w-7 h-7 flex items-center justify-center text-sm font-bold shadow-md">
                      &times;
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
