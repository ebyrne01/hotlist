"use client";

import { useMemo } from "react";
import { clsx } from "clsx";

interface TropeStepProps {
  tropes: { slug: string; name: string }[];
  selected: Set<string>;
  onToggle: (slug: string) => void;
  subgenres?: Set<string>;
}

const MIN_TROPES = 3;

/** Trope slugs to boost to the top when a subgenre is selected */
const SUBGENRE_TROPE_BOOSTS: Record<string, string[]> = {
  romantasy: [
    "fae-faerie", "enemies-to-lovers", "chosen-one", "forced-proximity",
    "slow-burn", "morally-grey", "mate-bond", "forbidden-love",
  ],
  paranormal: [
    "mate-bond", "fated-mates", "alpha-hero", "forced-proximity",
    "forbidden-love", "second-chance", "protector",
  ],
  "sci-fi-romance": [
    "fated-mates", "forced-proximity", "alien-romance", "found-family",
    "slow-burn", "forbidden-love",
  ],
  historical: [
    "enemies-to-lovers", "forbidden-love", "marriage-of-convenience",
    "slow-burn", "class-difference", "secret-identity", "rake-reformed",
  ],
  "romantic-suspense": [
    "protector", "forced-proximity", "second-chance", "secret-identity",
    "enemies-to-lovers", "slow-burn",
  ],
  "dark-romance": [
    "morally-grey", "enemies-to-lovers", "forced-proximity", "forbidden-love",
    "captor-captive", "bully-romance", "anti-hero",
  ],
  "erotic-romance": [
    "forbidden-love", "forced-proximity", "age-gap", "boss-employee",
    "friends-to-lovers",
  ],
  contemporary: [
    "friends-to-lovers", "enemies-to-lovers", "second-chance", "slow-burn",
    "fake-dating", "roommates", "small-town", "grumpy-sunshine",
    "office-romance", "sports-romance",
  ],
};

export default function TropeStep({ tropes, selected, onToggle, subgenres }: TropeStepProps) {
  // Sort tropes: boosted ones first, then the rest in original order
  const sortedTropes = useMemo(() => {
    if (!subgenres || subgenres.size === 0) return tropes;

    const boostedSlugs = new Set<string>();
    for (const sg of Array.from(subgenres)) {
      const boosts = SUBGENRE_TROPE_BOOSTS[sg];
      if (boosts) {
        for (const slug of boosts) boostedSlugs.add(slug);
      }
    }

    if (boostedSlugs.size === 0) return tropes;

    const boosted = tropes.filter((t) => boostedSlugs.has(t.slug));
    const rest = tropes.filter((t) => !boostedSlugs.has(t.slug));
    return [...boosted, ...rest];
  }, [tropes, subgenres]);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold text-ink">
          Pick tropes that make you pick up a book
        </h2>
        <p className="text-sm font-body text-muted mt-2">
          Select at least {MIN_TROPES}. These shape your Reading DNA.
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-2 max-w-lg mx-auto">
        {sortedTropes.map((trope) => {
          const isSelected = selected.has(trope.slug);
          return (
            <button
              key={trope.slug}
              onClick={() => onToggle(trope.slug)}
              className={clsx(
                "inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-mono whitespace-nowrap border transition-colors duration-150",
                isSelected
                  ? "bg-fire text-white border-fire"
                  : "bg-brand-cream-dk text-ink border-border/60 hover:bg-fire hover:text-white hover:border-fire"
              )}
            >
              {trope.name}
            </button>
          );
        })}
      </div>

      {selected.size > 0 && selected.size < MIN_TROPES && (
        <p className="text-center text-xs text-muted font-body">
          {MIN_TROPES - selected.size} more to go
        </p>
      )}
    </div>
  );
}
