"use client";

import { clsx } from "clsx";
import BookCover from "@/components/ui/BookCover";

interface CandidateBook {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
}

interface BookPickStepProps {
  books: CandidateBook[];
  selected: Set<string>;
  onToggle: (bookId: string) => void;
}

const MIN_BOOKS = 5;

export default function BookPickStep({ books, selected, onToggle }: BookPickStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold text-ink">
          Pick books you loved
        </h2>
        <p className="text-sm font-body text-muted mt-2">
          Select at least {MIN_BOOKS}. Tap covers to select.
        </p>
        {selected.size > 0 && (
          <p className="text-sm font-mono text-fire mt-1">
            {selected.size} selected
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 max-w-3xl mx-auto">
        {books.map((book) => {
          const isSelected = selected.has(book.id);
          return (
            <button
              key={book.id}
              onClick={() => onToggle(book.id)}
              className={clsx(
                "relative rounded-lg overflow-hidden transition-all",
                isSelected
                  ? "ring-3 ring-fire scale-[1.02]"
                  : "hover:scale-[1.02] hover:ring-2 hover:ring-fire/30"
              )}
              title={`${book.title} by ${book.author}`}
            >
              <BookCover
                title={book.title}
                coverUrl={book.coverUrl}
                size="md"
              />
              {isSelected && (
                <div className="absolute inset-0 bg-fire/20 flex items-center justify-center">
                  <span className="bg-fire text-white rounded-full w-7 h-7 flex items-center justify-center text-sm font-bold shadow-md">
                    ✓
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {selected.size > 0 && selected.size < MIN_BOOKS && (
        <p className="text-center text-xs text-muted font-body">
          {MIN_BOOKS - selected.size} more to go
        </p>
      )}
    </div>
  );
}
