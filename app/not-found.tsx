import Link from "next/link";
import SearchBar from "@/components/search/SearchBar";

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center">
      <h1 className="font-display text-3xl font-bold text-ink">
        Page not found
      </h1>
      <p className="mt-3 text-sm font-body text-ink/60 max-w-md">
        We couldn&apos;t find what you were looking for. Try searching for a
        book instead.
      </p>
      <div className="mt-6 w-full max-w-md">
        <SearchBar />
      </div>
      <Link
        href="/"
        className="mt-4 text-sm font-mono text-fire hover:text-fire/80 transition-colors"
      >
        &larr; Back to Home
      </Link>
    </div>
  );
}
