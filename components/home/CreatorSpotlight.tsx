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
    <section className="py-12">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fire">
            Follow the taste-makers
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold text-ink">
            Creators worth stalking
          </h2>
        </div>
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
            className="snap-start shrink-0 w-40 border-t border-aged-gold/50 bg-parchment px-4 py-5 hover:bg-blush/50 transition-colors text-center"
          >
            {/* Initials circle */}
            <div className="w-11 h-11 rounded-full bg-oxblood text-cream font-display font-bold text-sm flex items-center justify-center mx-auto ring-2 ring-aged-gold/30 ring-offset-2 ring-offset-parchment">
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
