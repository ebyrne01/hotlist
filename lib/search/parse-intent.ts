/**
 * Haiku intent parsing — extracts structured search filters from natural language.
 *
 * Cost: ~$0.001 per call (~300-500ms latency).
 * Only called for discovery/comparison/question queries (not title/author).
 * Cached in search_intent_cache (24h TTL) so common vibes only hit Haiku once.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { CANONICAL_SUBGENRES } from "@/lib/books/subgenre-classifier";

const VALID_SUBGENRES = new Set(CANONICAL_SUBGENRES.map((s) => s.slug));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export interface SearchFilters {
  tropes: string[];
  excludeTropes: string[];
  spiceMin: number | null;
  spiceMax: number | null;
  ratingMin: number | null;
  seriesComplete: boolean | null;
  standalone: boolean | null;
  subgenre: string | null;
  sortBy: "rating" | "spice" | "buzz" | "newest" | "relevance";
  trending: boolean;
  similarTo: string | null;
  moods: string[];
  textQuery: string | null;
}

const EMPTY_FILTERS: SearchFilters = {
  tropes: [],
  excludeTropes: [],
  spiceMin: null,
  spiceMax: null,
  ratingMin: null,
  seriesComplete: null,
  standalone: null,
  subgenre: null,
  sortBy: "relevance",
  trending: false,
  similarTo: null,
  moods: [],
  textQuery: null,
};

// Cache trope slugs in memory (refreshed every 2 hours)
let cachedTropeSlugs: string[] | null = null;
let tropeCacheTime = 0;
const TROPE_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

async function getTropeSlugs(): Promise<string[]> {
  const now = Date.now();
  if (cachedTropeSlugs && now - tropeCacheTime < TROPE_CACHE_TTL) {
    return cachedTropeSlugs;
  }

  const supabase = getAdminClient();
  const { data: tropes } = await supabase
    .from("tropes")
    .select("slug")
    .order("slug");

  cachedTropeSlugs = tropes?.map((t: { slug: string }) => t.slug) ?? [];
  tropeCacheTime = now;
  return cachedTropeSlugs;
}

/** Hash a query for cache lookup */
function hashQuery(query: string): string {
  return createHash("sha256")
    .update(query.toLowerCase().trim())
    .digest("hex")
    .slice(0, 32);
}

const CACHE_TTL_HOURS = 24;

/**
 * Parse a natural language search query into structured filters.
 * Checks cache first; falls back to Claude Haiku (~300ms, ~$0.001).
 */
export async function parseSearchIntent(
  query: string,
  queryType: "discovery" | "comparison" | "question"
): Promise<SearchFilters> {
  const supabase = getAdminClient();
  const queryHash = hashQuery(query);

  // Check cache first
  const { data: cached } = await supabase
    .from("search_intent_cache")
    .select("filters, created_at")
    .eq("query_hash", queryHash)
    .single();

  if (cached) {
    const age =
      Date.now() - new Date(cached.created_at).getTime();
    if (age < CACHE_TTL_HOURS * 60 * 60 * 1000) {
      return cached.filters as SearchFilters;
    }
  }

  const tropeSlugs = await getTropeSlugs();

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `You are a romance book search assistant. Parse this reader's search query into structured filters.

QUERY: "${query}"
QUERY TYPE: ${queryType}

Available trope slugs (use ONLY these exact values):
${tropeSlugs.join(", ")}

Spice scale: 1 = clean/sweet, 2 = mild/closed-door, 3 = steamy/moderate, 4 = spicy/explicit, 5 = scorching

Subgenres: contemporary, historical, paranormal, romantasy, sci-fi-romance, romantic-suspense, dark-romance, erotic-romance

Respond with ONLY a JSON object, no markdown, no explanation:
{
  "tropes": [],
  "excludeTropes": [],
  "spiceMin": null,
  "spiceMax": null,
  "ratingMin": null,
  "seriesComplete": null,
  "standalone": null,
  "subgenre": null,
  "sortBy": "relevance",
  "trending": false,
  "similarTo": null,
  "moods": [],
  "textQuery": null
}

Rules:
- IMPORTANT: Return at most 3 tropes. Pick the 2-3 most specific tropes the reader explicitly asked for. Do NOT infer extra tropes from reference books — "like ACOTAR" should set similarTo, NOT add fae-faerie + enemies-to-lovers + chosen-one.
- Map reader language to trope slugs: "fae" → "fae-faerie", "morally grey" → "morally-grey", "why choose" → "reverse-harem"
- "spicy" or "steamy" → spiceMin: 3. "really spicy" → spiceMin: 4. "scorching" → spiceMin: 5.
- "clean" or "sweet" → spiceMax: 1. "low spice" → spiceMax: 2. "closed door" → spiceMax: 2.
- "highly rated" or "popular" → ratingMin: 4.0 and sortBy: "rating"
- "trending" or "right now" or "what's hot" → trending: true, sortBy: "buzz"
- "new" or "recent" or "2025" or "2026" → sortBy: "newest"
- "finished series" or "completed" → seriesComplete: true
- "standalone" → standalone: true
- "like ACOTAR" → similarTo: "A Court of Thorns and Roses". Only add tropes the reader explicitly mentioned BEYOND the reference — e.g. "like ACOTAR but with slow burn" → similarTo + tropes: ["slow-burn"]
- "but spicier" → adjust spiceMin up from reference book's level
- "cozy", "dark", "angsty", "funny", "emotional", "fluffy", "brooding" → moods array
- subgenre: set ONLY if the reader explicitly names the subgenre (contemporary, historical, paranormal, romantasy, etc.). Do NOT infer subgenre from a reference book.
- If the query mentions a specific author name, put it in textQuery
- If you can't parse anything meaningful, set textQuery to the original query`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "{}";

  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());

    // Validate trope slugs — only allow slugs that actually exist
    const validSlugs = new Set(tropeSlugs);

    const filters: SearchFilters = {
      // Cap at 3 tropes to avoid over-narrow intersection
      tropes: (parsed.tropes ?? []).filter((s: string) => validSlugs.has(s)).slice(0, 3),
      excludeTropes: (parsed.excludeTropes ?? []).filter((s: string) =>
        validSlugs.has(s)
      ),
      spiceMin: parsed.spiceMin ?? null,
      spiceMax: parsed.spiceMax ?? null,
      ratingMin: parsed.ratingMin ?? null,
      seriesComplete: parsed.seriesComplete ?? null,
      standalone: parsed.standalone ?? null,
      subgenre: VALID_SUBGENRES.has(parsed.subgenre) ? parsed.subgenre : null,
      sortBy: parsed.sortBy ?? "relevance",
      trending: parsed.trending ?? false,
      similarTo: parsed.similarTo ?? null,
      moods: parsed.moods ?? [],
      textQuery: parsed.textQuery ?? null,
    };

    // Cache the result (fire-and-forget)
    supabase
      .from("search_intent_cache")
      .upsert({
        query_hash: queryHash,
        query_text: query.toLowerCase().trim(),
        filters,
      })
      .then(() => {});

    return filters;
  } catch {
    // If JSON parsing fails, fall back to text search
    return { ...EMPTY_FILTERS, textQuery: query };
  }
}
