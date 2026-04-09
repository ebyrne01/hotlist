import Link from "next/link";

export default function GenreNotFound() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-16 text-center">
      <h1 className="font-display text-2xl font-bold text-ink">
        Genre not found
      </h1>
      <p className="text-sm font-body text-muted mt-2">
        We don&apos;t have a genre page for this URL.
      </p>
      <Link
        href="/"
        className="inline-block mt-4 text-sm font-mono text-fire hover:text-fire/80 transition-colors"
      >
        &larr; Back to home
      </Link>
    </div>
  );
}
