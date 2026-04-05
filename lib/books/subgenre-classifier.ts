/**
 * SUBGENRE CLASSIFIER
 *
 * Maps a book's Goodreads genre/shelf tags to a single canonical subgenre.
 * Uses the same normalize() pattern as genre-bucketing.ts.
 *
 * Canonical subgenres (ordered by priority — first match wins):
 *   romantasy, paranormal, sci-fi-romance,
 *   historical, romantic-suspense,
 *   dark-romance, erotic-romance,
 *   contemporary
 *
 * Priority matters because books often have multiple genre tags.
 * A book tagged ["Fantasy", "Romance", "Dark Romance"] should be
 * "romantasy" not "dark-romance" — the fantasy setting is more
 * defining than the tone modifier.
 */

export const CANONICAL_SUBGENRES = [
  {
    slug: "romantasy",
    label: "Romantasy",
    description: "Fae courts, dragon riders, magic systems, epic quests",
  },
  {
    slug: "paranormal",
    label: "Paranormal Romance",
    description: "Shifters, vampires, werewolves, supernatural beings",
  },
  {
    slug: "sci-fi-romance",
    label: "Sci-Fi Romance",
    description: "Space, aliens, dystopia, futuristic settings",
  },
  {
    slug: "historical",
    label: "Historical Romance",
    description: "Regency, Victorian, medieval, past eras",
  },
  {
    slug: "romantic-suspense",
    label: "Romantic Suspense",
    description: "Danger, mystery, thriller with romance",
  },
  {
    slug: "dark-romance",
    label: "Dark Romance",
    description: "Morally grey, taboo, intense, anti-heroes",
  },
  {
    slug: "erotic-romance",
    label: "Erotic Romance",
    description: "Erotica-adjacent, very high heat, kink-forward",
  },
  {
    slug: "contemporary",
    label: "Contemporary Romance",
    description: "Modern settings, real-world love stories",
  },
] as const;

export type SubgenreSlug = (typeof CANONICAL_SUBGENRES)[number]["slug"];

// ── Normalize ────────────────────────────────────────

/** Normalize a genre/shelf string for matching (same as genre-bucketing.ts) */
function normalize(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// ── Rules ────────────────────────────────────────────

interface SubgenreRule {
  subgenre: SubgenreSlug;
  /** If ANY of these tags are present, this subgenre matches */
  primaryTags: string[];
  /** Match only if one of these is ALSO present */
  requiresAlso?: string[];
  /** If ANY of these are present, skip this rule */
  excludeIf?: string[];
}

const SUBGENRE_RULES: SubgenreRule[] = [
  // 1. ROMANTASY — fantasy + romance signals
  {
    subgenre: "romantasy",
    primaryTags: [
      "romantasy",
      "fantasy-romance",
      "romantic-fantasy",
      "fae",
      "fae-faerie",
      "epic-fantasy-romance",
    ],
  },
  {
    subgenre: "romantasy",
    primaryTags: [
      "fantasy",
      "high-fantasy",
      "epic-fantasy",
      "sword-and-sorcery",
    ],
    requiresAlso: ["romance", "love", "romantic", "fantasy-romance"],
    excludeIf: [
      "dark-romance", "dark",
      "historical-fiction", "historical-romance", "historical",
      "regency", "regency-romance", "victorian-romance", "medieval-romance",
      "thriller", "suspense", "romantic-suspense",
      "time-travel",
    ],
  },

  // 2. PARANORMAL — supernatural beings, not epic fantasy
  {
    subgenre: "paranormal",
    primaryTags: [
      "paranormal-romance",
      "pnr",
      "shifter-romance",
      "shifter",
      "vampire-romance",
      "vampires",
      "werewolves",
      "werewolf-romance",
      "shapeshifter",
      "witches",
      "demons",
      "angels",
      "ghost-romance",
      "alien-romance",
      "monster-romance",
    ],
  },
  {
    subgenre: "paranormal",
    primaryTags: ["paranormal", "supernatural", "urban-fantasy"],
    requiresAlso: ["romance", "romantic", "love"],
  },

  // 3. SCI-FI ROMANCE — space, aliens, dystopia
  {
    subgenre: "sci-fi-romance",
    primaryTags: [
      "sci-fi-romance",
      "science-fiction-romance",
      "space-opera-romance",
      "futuristic-romance",
      "dystopian-romance",
    ],
  },
  {
    subgenre: "sci-fi-romance",
    primaryTags: [
      "science-fiction",
      "sci-fi",
      "dystopian",
      "post-apocalyptic",
      "space-opera",
    ],
    requiresAlso: ["romance", "romantic", "love"],
  },

  // 4. HISTORICAL — past eras
  {
    subgenre: "historical",
    primaryTags: [
      "historical-romance",
      "regency-romance",
      "regency",
      "victorian-romance",
      "medieval-romance",
      "highland-romance",
      "scottish-romance",
      "western-romance",
      "pirate-romance",
    ],
  },
  {
    subgenre: "historical",
    primaryTags: ["historical", "historical-fiction"],
    requiresAlso: ["romance", "romantic", "love"],
  },

  // 5. ROMANTIC SUSPENSE — danger + romance
  {
    subgenre: "romantic-suspense",
    primaryTags: [
      "romantic-suspense",
      "romance-suspense",
      "romantic-thriller",
    ],
  },
  {
    subgenre: "romantic-suspense",
    primaryTags: ["suspense", "thriller", "mystery"],
    requiresAlso: ["romance", "romantic", "love"],
    excludeIf: ["dark-romance", "dark"],
  },

  // 6. DARK ROMANCE — tone modifier, lower priority than setting-based subgenres
  {
    subgenre: "dark-romance",
    primaryTags: [
      "dark-romance",
      "mafia-romance",
      "bully-romance",
      "captive-romance",
      "stalker-romance",
      "taboo-romance",
    ],
  },
  {
    subgenre: "dark-romance",
    primaryTags: ["dark"],
    requiresAlso: ["romance", "romantic", "love", "dark-romance"],
  },

  // 7. EROTIC ROMANCE — heat-defined, lower priority than setting
  {
    subgenre: "erotic-romance",
    primaryTags: ["erotic-romance", "erotica", "smut", "bdsm", "kink"],
  },

  // 8. CONTEMPORARY — the default/catch-all for modern-day romance
  {
    subgenre: "contemporary",
    primaryTags: [
      "contemporary-romance",
      "rom-com",
      "romantic-comedy",
      "new-adult",
      "college-romance",
      "sports-romance",
      "office-romance",
      "small-town-romance",
      "beach-read",
      "chick-lit",
      "womens-fiction",
      "billionaire-romance",
      "military-romance",
      "cowboy-romance",
      "rockstar-romance",
      "celebrity-romance",
      "holiday-romance",
      "christmas-romance",
      "summer-romance",
    ],
  },
  // Final fallback: if "romance" tag exists but nothing more specific matched
  {
    subgenre: "contemporary",
    primaryTags: ["romance", "love-story", "love"],
  },
];

// ── Classifier ───────────────────────────────────────

/**
 * Classify a book into a single canonical subgenre based on its genre tags.
 *
 * Returns null if no genre tags exist or none match any rules.
 */
export function classifySubgenre(genres: string[]): SubgenreSlug | null {
  if (!genres || genres.length === 0) return null;

  const normalizedGenres = new Set(genres.map(normalize));

  for (const rule of SUBGENRE_RULES) {
    const hasPrimary = rule.primaryTags.some((tag) => normalizedGenres.has(tag));
    if (!hasPrimary) continue;

    if (rule.requiresAlso) {
      const hasRequired = rule.requiresAlso.some((tag) =>
        normalizedGenres.has(tag)
      );
      if (!hasRequired) continue;
    }

    if (rule.excludeIf) {
      const hasExcluded = rule.excludeIf.some((tag) =>
        normalizedGenres.has(tag)
      );
      if (hasExcluded) continue;
    }

    return rule.subgenre;
  }

  return null;
}
