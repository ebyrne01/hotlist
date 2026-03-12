/**
 * GENRE BUCKETING — Rule-based spice inference from genre tags
 *
 * Maps known genre/shelf names to spice ranges. This is the lowest-confidence
 * signal but provides baseline coverage for every book with genre data.
 * No API calls — purely local computation.
 */

const GENRE_SPICE_MAP: Record<string, { spice: number; confidence: number }> = {
  // High spice (4-5 peppers)
  "erotic-romance": { spice: 4.5, confidence: 0.7 },
  "erotica": { spice: 5.0, confidence: 0.8 },
  "dark-romance": { spice: 4.0, confidence: 0.5 },
  "reverse-harem": { spice: 4.0, confidence: 0.5 },
  "why-choose": { spice: 4.0, confidence: 0.5 },
  "steamy-romance": { spice: 3.5, confidence: 0.6 },
  "steamy": { spice: 3.5, confidence: 0.6 },
  "smut": { spice: 4.5, confidence: 0.7 },

  // Medium spice (2-3 peppers)
  "contemporary-romance": { spice: 2.5, confidence: 0.3 },
  "paranormal-romance": { spice: 2.5, confidence: 0.3 },
  "fantasy-romance": { spice: 2.5, confidence: 0.3 },
  "romantasy": { spice: 2.5, confidence: 0.3 },
  "romance": { spice: 2.5, confidence: 0.2 },
  "historical-romance": { spice: 2.0, confidence: 0.3 },
  "romantic-suspense": { spice: 2.0, confidence: 0.3 },

  // Low spice (0-1 peppers)
  "clean-romance": { spice: 0.5, confidence: 0.8 },
  "clean-and-wholesome": { spice: 0.5, confidence: 0.8 },
  "sweet-romance": { spice: 0.5, confidence: 0.7 },
  "closed-door": { spice: 0, confidence: 0.8 },
  "christian-romance": { spice: 0, confidence: 0.9 },
  "inspirational-romance": { spice: 0, confidence: 0.8 },
  "ya-romance": { spice: 0.5, confidence: 0.7 },
  "young-adult": { spice: 0.5, confidence: 0.5 },
};

/** Normalize a genre/shelf string for matching */
function normalize(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export interface GenreBucketingResult {
  spice: number;
  confidence: number;
  matchedTags: string[];
}

/**
 * Compute a spice estimate from genre tags.
 * If multiple genres match, averages their spice values and takes the max confidence.
 */
export function computeGenreBucketing(genres: string[]): GenreBucketingResult | null {
  if (!genres || genres.length === 0) return null;

  const matchedTags: string[] = [];
  let spiceSum = 0;
  let maxConfidence = 0;

  for (const raw of genres) {
    const normalized = normalize(raw);
    const match = GENRE_SPICE_MAP[normalized];
    if (match) {
      matchedTags.push(normalized);
      spiceSum += match.spice;
      maxConfidence = Math.max(maxConfidence, match.confidence);
    }
  }

  if (matchedTags.length === 0) return null;

  const avgSpice = Math.round((spiceSum / matchedTags.length) * 10) / 10;

  return {
    spice: avgSpice,
    confidence: maxConfidence,
    matchedTags,
  };
}
