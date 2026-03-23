/**
 * Rule-based query classification — instant, free, no AI call.
 *
 * Determines whether a search query is a simple title/author lookup
 * (handled by existing FTS) or a natural-language discovery query
 * that needs Haiku intent parsing.
 */

export type QueryIntent =
  | { type: "title_author"; query: string }
  | { type: "discovery"; raw: string }
  | { type: "comparison"; raw: string }
  | { type: "question"; raw: string }
  | { type: "video_url"; url: string };

export function classifyQuery(input: string): QueryIntent {
  const trimmed = input.trim();

  // Video URL detection (already handled in SearchBar, but belt-and-suspenders)
  if (/^https?:\/\/(www\.)?(tiktok|instagram|youtube|vm\.tiktok|youtu\.be)/.test(trimmed)) {
    return { type: "video_url", url: trimmed };
  }

  // Question patterns — "what's the best...", "recommend me...", "find me..."
  if (/^(what|which|who|recommend|suggest|find me|show me|give me|any)\b/i.test(trimmed)) {
    return { type: "question", raw: trimmed };
  }

  // Comparison patterns — "like ACOTAR", "similar to Fourth Wing but..."
  if (/\b(like|similar to|same vibe|reminds me of)\b/i.test(trimmed)) {
    // Only classify as comparison if there's a "but/except/more/less" modifier
    // OR the phrase explicitly says "like/similar to"
    return { type: "comparison", raw: trimmed };
  }

  // Discovery patterns: trope names, spice words, mood descriptors, constraints
  const DISCOVERY_SIGNALS = [
    // Trope names (fuzzy — readers don't use slugs)
    /enemies.to.lovers/i, /slow.burn/i, /forced.proximity/i, /fated.mates/i,
    /fake.dating/i, /grumpy.sunshine/i, /reverse.harem/i, /why.choose/i,
    /morally.grey/i, /dark.romance/i, /forbidden/i, /second.chance/i,
    /found.family/i, /\bfae\b/i, /\bdragon/i, /\bvampire/i, /\bshifter/i,
    /\bmafia\b/i, /\bacademy\b/i, /arranged.marriage/i, /\bbodyguard\b/i,
    /age.gap/i, /office.romance/i, /sports.romance/i, /\bbillionaire/i,
    /love.triangle/i, /friends.to.lovers/i, /chosen.one/i, /\bmonster/i,
    /holiday.romance/i, /instalove/i,
    // Spice descriptors
    /\bspicy\b/i, /\bspice\b/i, /\bsteamy\b/i, /\bclean\b/i, /\bsweet\b/i,
    /\bscorching\b/i, /\bexplicit\b/i, /closed.door/i, /open.door/i,
    /low.spice/i, /high.spice/i, /no.spice/i,
    // Mood / constraint words
    /finished.series/i, /\bcompleted?\b/i, /\bstandalone\b/i,
    /\bpopular\b/i, /highly.rated/i, /\btrending\b/i,
    /\bcozy\b/i, /\bdark\b/i, /\bfunny\b/i, /\bangst/i, /\blight\b/i,
    /\bemotional\b/i, /\bfluffy\b/i, /\bbrooding\b/i,
    // Subgenre signals
    /\bcontemporary\b/i, /\bhistorical\b/i, /\bparanormal\b/i,
    /\bfantasy\b/i, /\bromantasy\b/i, /\bsci.?fi\b/i, /\bsuspense\b/i,
    // Recency
    /\bnew\b/i, /\brecent\b/i, /\b2025\b/, /\b2026\b/, /\bthis year\b/i,
  ];

  if (DISCOVERY_SIGNALS.some((re) => re.test(trimmed))) {
    return { type: "discovery", raw: trimmed };
  }

  // Default: title/author keyword search (existing FTS path)
  return { type: "title_author", query: trimmed };
}
