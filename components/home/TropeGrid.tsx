import Link from "next/link";
import { clsx } from "clsx";

interface TropeWithCount {
  id: string;
  slug: string;
  name: string;
  bookCount?: number;
}

interface TropeGridProps {
  tropes: TropeWithCount[];
}

const TROPE_GROUPS: { label: string; slugs: string[] }[] = [
  {
    label: "Romance Classics",
    slugs: [
      "enemies-to-lovers",
      "slow-burn",
      "friends-to-lovers",
      "fake-dating",
      "second-chance",
      "grumpy-sunshine",
      "forbidden-romance",
      "love-triangle",
      "arranged-marriage",
    ],
  },
  {
    label: "Contemporary & Settings",
    slugs: [
      "office-romance",
      "sports-romance",
      "small-town",
      "billionaire",
      "holiday-romance",
      "bodyguard-romance",
      "age-gap",
      "forced-proximity",
    ],
  },
  {
    label: "Dark & Paranormal",
    slugs: [
      "dark-romance",
      "mafia-romance",
      "reverse-harem",
      "vampire",
      "shifter",
      "fae-faerie",
      "chosen-one",
      "insta-love",
    ],
  },
];

// Tropes with high counts get a slightly bolder style
const POPULAR_THRESHOLD = 50;

export default function TropeGrid({ tropes }: TropeGridProps) {
  const tropeMap = new Map(tropes.map((t) => [t.slug, t]));

  // Build grouped list, then collect any ungrouped tropes
  const groupedSlugs = new Set(TROPE_GROUPS.flatMap((g) => g.slugs));
  const ungrouped = tropes.filter((t) => !groupedSlugs.has(t.slug));

  return (
    <div className="space-y-6">
      {TROPE_GROUPS.map((group) => {
        const groupTropes = group.slugs
          .map((slug) => tropeMap.get(slug))
          .filter(Boolean) as TropeWithCount[];

        if (groupTropes.length === 0) return null;

        return (
          <div key={group.label}>
            <h3 className="text-xs font-mono text-muted/80 uppercase tracking-wider mb-2 text-center">
              {group.label}
            </h3>
            <div className="flex flex-wrap gap-2 justify-center">
              {groupTropes.map((trope) => {
                const isPopular = (trope.bookCount ?? 0) >= POPULAR_THRESHOLD;
                return (
                  <Link
                    key={trope.id}
                    href={`/tropes/${trope.slug}`}
                    className={clsx(
                      "rounded-full border font-body transition-all hover:shadow-md hover:border-fire/40 hover:bg-fire/5 inline-flex items-center justify-center text-center leading-none gap-1.5",
                      isPopular
                        ? "px-5 py-2.5 text-sm border-border bg-white text-ink font-medium"
                        : "px-4 py-2 text-sm border-border bg-white text-ink/70 hover:text-ink"
                    )}
                  >
                    {trope.name}
                    {trope.bookCount != null && trope.bookCount > 0 && (
                      <span className="text-xs font-mono text-muted/70">
                        ({trope.bookCount})
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Any tropes not in a group */}
      {ungrouped.length > 0 && (
        <div>
          <h3 className="text-xs font-mono text-muted/80 uppercase tracking-wider mb-2 text-center">
            More Tropes
          </h3>
          <div className="flex flex-wrap gap-2 justify-center">
            {ungrouped.map((trope) => (
              <Link
                key={trope.id}
                href={`/tropes/${trope.slug}`}
                className="rounded-full border border-border bg-white px-4 py-2 text-sm font-body text-ink/70 hover:text-ink hover:shadow-md hover:border-fire/40 hover:bg-fire/5 transition-all inline-flex items-center gap-1.5"
              >
                {trope.name}
                {trope.bookCount != null && trope.bookCount > 0 && (
                  <span className="text-xs font-mono text-muted/70">
                    ({trope.bookCount})
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
