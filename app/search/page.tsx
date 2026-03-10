export const dynamic = "force-dynamic";

import { findBook } from "@/lib/books";
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
        <div className="text-center py-16">
          <p className="text-lg font-body text-muted">
            No results for &ldquo;{query}&rdquo;
          </p>
          <p className="text-sm font-body text-muted/60 mt-2">
            Try a different title or author
          </p>
          <a
            href="/booktok"
            className="inline-flex items-center gap-2 mt-4 text-sm font-mono text-fire hover:text-fire/80 transition-colors"
          >
            📹 Or paste a BookTok link to find books from a video &rarr;
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
