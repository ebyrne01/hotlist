import Link from "next/link";

interface Genre {
  slug: string;
  label: string;
  description: string;
}

export default function GenrePills({ genres }: { genres: readonly Genre[] }) {
  const romantasy = genres.find((genre) => genre.slug === "romantasy");
  const remainingGenres = genres.filter((genre) => genre.slug !== "romantasy");

  return (
    <section className="border-t border-aged-gold/30 py-12 sm:py-16">
      <div className="grid gap-6 sm:grid-cols-[1.1fr_1fr] sm:items-center">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fire">
            Choose your realm
          </p>
          <h2 className="mt-1 font-display text-3xl font-bold text-ink">
            Where are we escaping tonight?
          </h2>
          <p className="mt-2 max-w-md text-sm font-body leading-relaxed text-muted-a11y">
            Start with fae bargains and dragon riders, or follow whatever kind
            of trouble your mood is asking for.
          </p>
        </div>
        {romantasy && (
          <Link
            href={`/genre/${romantasy.slug}`}
            className="group relative overflow-hidden surface-night px-5 py-6 text-cream transition-transform hover:-translate-y-0.5"
          >
            <div className="absolute inset-0 surface-night-stars opacity-40" />
            <div className="relative">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-aged-gold">
                Enter the featured shelf
              </p>
              <h3 className="mt-1 font-display text-3xl font-bold">
                {romantasy.label}
              </h3>
              <p className="mt-1 text-sm font-body text-cream/70">
                {romantasy.description}
              </p>
              <p className="mt-4 font-mono text-xs uppercase tracking-wide text-fire">
                Cross the threshold &rarr;
              </p>
            </div>
          </Link>
        )}
      </div>
      <div className="mt-7 flex flex-wrap gap-2">
        {remainingGenres.map((genre) => (
          <Link
            key={genre.slug}
            href={`/genre/${genre.slug}`}
            className="px-3 py-2 border-b border-border text-xs font-mono text-muted-a11y hover:border-fire hover:text-fire transition-colors"
            title={genre.description}
          >
            {genre.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
