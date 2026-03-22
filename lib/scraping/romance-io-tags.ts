/**
 * Romance.io tag classification and mapping.
 *
 * Maps romance.io's tag vocabulary to Hotlist's canonical trope slugs,
 * plus categorizes tags as genres, content warnings, or character descriptors.
 *
 * romance.io snippets typically contain 3-6 tags before Serper truncation.
 * These are the most prominent tags for each book — high signal.
 */

// Map romance.io tag strings → Hotlist canonical trope slugs
export const ROMANCE_IO_TROPE_MAP: Record<string, string> = {
  // Enemies to lovers variants
  "from hate to love": "enemies-to-lovers",
  "enemies to lovers": "enemies-to-lovers",
  "enemies-to-lovers": "enemies-to-lovers",
  "hate-to-love": "enemies-to-lovers",
  "from hate to": "enemies-to-lovers", // truncated snippet

  // Friends to lovers
  "friends to lovers": "friends-to-lovers",
  "friends-to-lovers": "friends-to-lovers",
  "friends to": "friends-to-lovers", // truncated snippet

  // Slow burn
  "slow burn": "slow-burn",
  "slow-burn": "slow-burn",

  // Second chance
  "second chances": "second-chance",
  "second-chance": "second-chance",
  "second chance": "second-chance",

  // Forbidden
  "forbidden love": "forbidden-romance",
  "forbidden-love": "forbidden-romance",
  "forbidden": "forbidden-romance",

  // Fake dating
  "fake-dating": "fake-dating",
  "fake dating": "fake-dating",
  "fake-relationship": "fake-dating",

  // Forced proximity
  "forced proximity": "forced-proximity",
  "forced-proximity": "forced-proximity",

  // Marriage of convenience / arranged marriage
  "marriage of convenience": "arranged-marriage",
  "arranged-marriage": "arranged-marriage",
  "arranged marriage": "arranged-marriage",

  // Love triangle
  "love triangle": "love-triangle",
  "love-triangle": "love-triangle",
  "other-man-woman": "love-triangle",

  // Fated mates
  "fated-mates": "fated-mates",
  "fated mates": "fated-mates",
  "fated": "fated-mates", // truncated snippet

  // Insta-love
  "insta-love": "instalove",
  "instalove": "instalove",

  // Age gap
  "age difference": "age-gap",
  "age-gap": "age-gap",
  "age gap": "age-gap",
  "age": "age-gap", // truncated snippet

  // Found family
  "found-family": "found-family",
  "found family": "found-family",

  // Reverse harem / why choose
  "reverse harem": "reverse-harem",
  "reverse-harem": "reverse-harem",
  "why-choose": "reverse-harem",

  // Grumpy/sunshine
  "grumpy-sunshine": "grumpy-sunshine",
  "grumpy sunshine": "grumpy-sunshine",

  // Dark romance
  "dark": "dark-romance",
  "dark romance": "dark-romance",
  "dark-romance": "dark-romance",
  "bdsm": "dark-romance",

  // Fae / faerie
  "fae": "fae-faerie",
  "faerie": "fae-faerie",
  "fae-romance": "fae-faerie",

  // Shifter
  "shapeshifters": "shifter",
  "shifters": "shifter",
  "shifter": "shifter",
  "werewolves": "shifter",

  // Vampire
  "vampires": "vampire",
  "vampire": "vampire",

  // Dragon riders
  "dragons": "dragon-riders",
  "dragon riders": "dragon-riders",

  // Billionaire
  "billionaire": "billionaire",
  "super rich hero": "billionaire",

  // Bodyguard
  "bodyguard-hero": "bodyguard-romance",
  "bodyguard": "bodyguard-romance",

  // Small town
  "small town": "small-town",
  "small-town": "small-town",

  // Sports
  "sports": "sports-romance",
  "sports-romance": "sports-romance",
  "hockey": "sports-romance",
  "athletes": "sports-romance",
  "football": "sports-romance",
  "baseball": "sports-romance",

  // Office
  "office romance": "office-romance",
  "office-romance": "office-romance",
  "workplace": "office-romance",

  // Holiday
  "holiday": "holiday-romance",
  "christmas": "holiday-romance",

  // Mafia
  "mafia": "mafia-romance",
  "mafia-romance": "mafia-romance",
  "organized crime": "mafia-romance",

  // Monster romance
  "monster-romance": "monster-romance",
  "monsters": "monster-romance",

  // Morally grey
  "morally grey": "morally-grey",
  "morally-grey": "morally-grey",
  "anti-hero": "morally-grey",

  // Mortal / immortal
  "mortal-immortal": "mortal-immortal",

  // Chosen one
  "chosen one": "chosen-one",
  "chosen-one": "chosen-one",

  // Court / academy
  "academy": "court-academy",
  "magical academy": "court-academy",

  // Secret relationship
  "secret-relationship": "forbidden-romance",

  // Abduction / captive
  "abduction": "dark-romance",
  "captive": "dark-romance",

  // Only one bed
  "only-one-bed": "forced-proximity",
};

// Genre tags — not tropes, but useful metadata
export const GENRE_TAGS = new Set([
  "fantasy",
  "high fantasy",
  "paranormal",
  "new adult",
  "young adult",
  "contemporary",
  "historical",
  "dystopian",
  "erotica",
  "romantic suspense",
  "suspense",
  "mystery",
  "science fiction",
  "sci-fi",
  "legends & fairy tales",
  "comedy",
  "humor",
  "horror",
  "urban fantasy",
  "mythology",
  "retelling",
  "western",
  "regency",
  "medieval",
  "steampunk",
  "post-apocalyptic",
  "military",
  "thriller",
  "demons",
  "aliens",
  "time travel",
  "highlander",
  "college",
  "multicultural",
]);

// Content warning tags
export const CONTENT_WARNING_TAGS = new Set([
  "abuse",
  "abuse-non-mc",
  "past-abuse",
  "past-child-abuse",
  "past-child-neglect",
  "past-sexual-abuse",
  "death",
  "child-death",
  "animal-death",
  "animal-abuse",
  "graphic-violence",
  "violence",
  "dub-con",
  "consensual-non-con",
  "non-con",
  "human-trafficking",
  "slavery",
  "mental-trauma",
  "mental illness",
  "self harm",
  "suicide",
  "eating disorder",
  "misogyny",
  "racism",
  "victim-blaming",
  "slut-shaming",
  "religious-trauma",
  "torture",
  "torture-mcs",
  "torture-scs",
  "body-betrayal",
  "rape-non-mc",
  "miscarriage",
  "pregnancy-loss",
  "addiction",
  "cheating",
  "infidelity",
  "cliffhanger",
  "non-hea",
  "non-trad-hea",
  "kidnapping",
  "bullying",
  "stalking",
  "blood",
  "gore",
  "war",
]);

// Character descriptor tags (not tropes — informational)
export const CHARACTER_TAGS = new Set([
  "alpha male",
  "cold hero",
  "sweet-hero",
  "tortured hero",
  "possessive hero",
  "bad boys",
  "dangerous heroine",
  "strong heroine",
  "sassy heroine",
  "competent heroine",
  "independent heroine",
  "gifted heroine",
  "curvy heroine",
  "tall-heroine",
  "warrior-heroine",
  "aristocratic heroine",
  "famous heroine",
  "poor heroine",
  "working class heroine",
  "virgin heroine",
  "tortured heroine",
  "non-human-hero",
  "non-human-heroine",
  "fighters",
  "commander",
  "men in uniform",
  "royalty",
  "magic",
  "witches",
]);

// Relationship structure tags
export const RELATIONSHIP_TAGS = new Set([
  "m-f",
  "f-f",
  "m-m",
  "m-m-f",
  "m-f-m",
  "f-f-m",
  "dual-pov",
  "male-pov",
  "first-person-pov",
  "childfree-couple",
  "multiple-pov",
  "bisexual",
  "lgbtq",
  "queer",
  "non-binary",
  "transgender",
  "menage",
]);

export interface ParsedRomanceIoTags {
  tropes: { tag: string; canonicalSlug: string }[];
  genres: string[];
  contentWarnings: string[];
  characterTags: string[];
  relationshipTags: string[];
  uncategorized: string[];
  rawTags: string[];
}

/**
 * Parse and classify tags from a romance.io snippet's "tagged as" section.
 */
export function classifyRomanceIoTags(rawTags: string[]): ParsedRomanceIoTags {
  const result: ParsedRomanceIoTags = {
    tropes: [],
    genres: [],
    contentWarnings: [],
    characterTags: [],
    relationshipTags: [],
    uncategorized: [],
    rawTags,
  };

  const seenTropeSlugs = new Set<string>();

  for (const tag of rawTags) {
    const lower = tag.toLowerCase().trim();
    if (!lower) continue;

    // Check trope mapping first
    const tropeSlug = ROMANCE_IO_TROPE_MAP[lower];
    if (tropeSlug && !seenTropeSlugs.has(tropeSlug)) {
      seenTropeSlugs.add(tropeSlug);
      result.tropes.push({ tag: lower, canonicalSlug: tropeSlug });
      continue;
    }
    if (tropeSlug) continue; // Duplicate trope slug

    if (GENRE_TAGS.has(lower)) {
      result.genres.push(lower);
    } else if (CONTENT_WARNING_TAGS.has(lower)) {
      result.contentWarnings.push(lower);
    } else if (CHARACTER_TAGS.has(lower)) {
      result.characterTags.push(lower);
    } else if (RELATIONSHIP_TAGS.has(lower)) {
      result.relationshipTags.push(lower);
    } else {
      result.uncategorized.push(lower);
    }
  }

  return result;
}

/**
 * Extract tags from a romance.io snippet's "tagged as ..." section.
 * Returns raw tag strings (before classification).
 */
export function extractTagsFromSnippet(snippet: string): string[] {
  // Pattern: "'Title' is tagged as tag1, tag2, tag3, ..."
  // Also handles: "is tagged as tag1, tag2, ..." without quotes around title
  const tagMatch = snippet.match(/(?:is )?tagged as\s+(.+?)(?:\.\s|$)/i);
  if (!tagMatch) return [];

  return tagMatch[1]
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t.length < 60)
    // Remove trailing ".." or "..." from truncated snippets
    .map((t) => t.replace(/\s*\.{2,}$/, "").trim())
    .filter((t) => t.length > 1);
}
