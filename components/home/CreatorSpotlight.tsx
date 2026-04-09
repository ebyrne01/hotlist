import Link from "next/link";

export interface SpotlightCreator {
  id: string;
  handle: string;
  platform: string;
  bookCount: number;
}

export default function CreatorSpotlight({
  creators,
}: {
  creators: SpotlightCreator[];
}) {
  if (creators.length === 0) return null;

  return (
    <section className="py-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-xl font-bold text-ink">
          Trending Creators
        </h2>
        <Link
          href="/discover"
          className="text-xs font-mono text-fire hover:text-fire/80 transition-colors"
        >
          See all &rarr;
        </Link>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x snap-mandatory">
        {creators.map((creator) => (
          <Link
            key={creator.id}
            href={`/discover/@${creator.handle}`}
            className="snap-start shrink-0 w-36 rounded-xl border border-border bg-white p-4 hover:border-muted/40 transition-colors text-center"
          >
            {/* Initials circle */}
            <div className="w-10 h-10 rounded-full bg-fire/10 text-fire font-display font-bold text-sm flex items-center justify-center mx-auto">
              {creator.handle.slice(0, 2).toUpperCase()}
            </div>
            <p className="font-mono text-xs text-ink mt-2 truncate">
              @{creator.handle}
            </p>
            <p className="text-[11px] font-mono text-muted mt-0.5">
              {creator.bookCount} book{creator.bookCount !== 1 ? "s" : ""}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
