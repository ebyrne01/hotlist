import Link from "next/link";
import { clsx } from "clsx";

interface TropeGridProps {
  tropes: { id: string; slug: string; name: string }[];
}

// These tropes get a slightly larger pill
const POPULAR_SLUGS = [
  "enemies-to-lovers",
  "slow-burn",
  "forced-proximity",
  "friends-to-lovers",
  "grumpy-sunshine",
  "fake-dating",
  "dark-romance",
  "fae-faerie",
];

export default function TropeGrid({ tropes }: TropeGridProps) {
  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {tropes.map((trope) => {
        const isPopular = POPULAR_SLUGS.includes(trope.slug);
        return (
          <Link
            key={trope.id}
            href={`/tropes/${trope.slug}`}
            className={clsx(
              "rounded-full border font-body transition-all hover:shadow-md hover:border-fire/40 hover:bg-fire/5 inline-flex items-center justify-center text-center leading-none",
              isPopular
                ? "px-5 py-2.5 text-sm border-border bg-white text-ink font-medium"
                : "px-4 py-2 text-sm border-border bg-white text-ink/70 hover:text-ink"
            )}
          >
            {trope.name}
          </Link>
        );
      })}
    </div>
  );
}
