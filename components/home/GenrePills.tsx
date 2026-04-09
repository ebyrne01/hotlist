import Link from "next/link";

interface Genre {
  slug: string;
  label: string;
  description: string;
}

export default function GenrePills({ genres }: { genres: readonly Genre[] }) {
  return (
    <section className="py-8">
      <h2 className="font-display text-xl font-bold text-ink text-center mb-4">
        Browse by Genre
      </h2>
      <div className="flex flex-wrap gap-2 justify-center">
        {genres.map((genre) => (
          <Link
            key={genre.slug}
            href={`/genre/${genre.slug}`}
            className="px-4 py-2 rounded-full border border-border bg-white text-sm font-mono text-ink hover:border-fire/30 hover:text-fire transition-colors"
            title={genre.description}
          >
            {genre.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
