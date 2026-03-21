export const dynamic = "force-dynamic";

import { findBook } from "@/lib/books";
import { Video } from "lucide-react";
import BookCard from "@/components/books/BookCard";


interface SearchPageProps {
  searchParams: { q?: string };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const query = searchParams.q ?? "";
  const books = query ? await findBook(query) : [];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {query && (
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink mb-6">
          Results for &ldquo;{query}&rdquo;
        </h1>
      )}

      {!query && (
        <div className="text-center py-16">
          <p className="text-lg font-body text-muted">
            Enter a search to find books
          </p>
        </div>
      )}

      {query && books.length === 0 && (
        <div className="text-center py-16 max-w-md mx-auto">
          <p className="text-lg font-display font-bold text-ink">
            We don&apos;t have &ldquo;{query}&rdquo; yet
          </p>
          <div className="mt-4 text-sm font-body text-muted space-y-1.5 text-left">
            <p>Try searching for:</p>
            <ul className="list-disc list-inside space-y-1 text-muted/80">
              <li>A different spelling</li>
              <li>Just the author&apos;s name</li>
              <li>
                A trope instead &rarr;{" "}
                <a href="/tropes" className="text-fire hover:text-fire/80 font-mono text-xs transition-colors">
                  browse tropes
                </a>
              </li>
            </ul>
          </div>
          <a
            href="/booktok"
            className="inline-flex items-center gap-2 mt-6 text-sm font-mono text-fire hover:text-fire/80 transition-colors"
          >
            <Video size={14} className="inline -mt-0.5" aria-hidden="true" />
            Paste a BookTok link to find books from a video &rarr;
          </a>
        </div>
      )}

      {books.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {books.map((book) => (
            <BookCard key={book.id} book={book} layout="list" />
          ))}
        </div>
      )}
    </div>
  );
}
