import Link from "next/link";
import SearchBar from "@/components/search/SearchBar";

export default function BookNotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center">
      <h1 className="font-display text-2xl font-bold text-ink">
        Book not found
      </h1>
      <p className="mt-3 text-sm font-body text-ink/60 max-w-md">
        We couldn&apos;t find a book at this URL. It may have been removed or
        the link might be incorrect.
      </p>
      <div className="mt-6 w-full max-w-md">
        <SearchBar />
      </div>
      <Link
        href="/"
        className="mt-4 text-sm font-mono text-fire hover:text-fire/80 transition-colors"
      >
        &larr; Browse trending books
      </Link>
    </div>
  );
}
