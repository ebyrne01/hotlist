export const dynamic = "force-dynamic";

import { findBook } from "@/lib/books";
import { classifyQuery } from "@/lib/search/classify-query";
import { parseSearchIntent } from "@/lib/search/parse-intent";
import type { SearchFilters } from "@/lib/search/parse-intent";
import { executeFilteredSearch } from "@/lib/search/execute-filters";
import { createClient } from "@/lib/supabase/server";
import { getDna } from "@/lib/reading-dna";
import { reRankByDna } from "@/lib/reading-dna/score";
import { logSearchAnalytics } from "@/lib/search/analytics";
import { captureSearchDemand } from "@/lib/search/demand-capture";
import { Search, SlidersHorizontal, Sparkles, Video } from "lucide-react";
import BookCard from "@/components/books/BookCard";
import SearchFeedback from "@/components/search/SearchFeedback";
import MissingBookRequest from "@/components/search/MissingBookRequest";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { BookDetail } from "@/lib/types";
import { randomUUID } from "crypto";

interface SearchPageProps {
  searchParams: { q?: string };
}

/** Convert trope slug to display name: "enemies-to-lovers" → "Enemies to Lovers" */
function tropeDisplayName(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const SEARCH_EXAMPLES = [
  "spicy fae enemies to lovers",
  "like Fourth Wing but darker",
  "low spice cozy romantasy",
  "dark romance standalone",
];

function filterSummary(filters: SearchFilters | null): string {
  if (!filters) return "Title, author, trope, or vibe";

  const parts: string[] = [];
  if (filters.similarTo) parts.push(`similar to ${filters.similarTo}`);
  if (filters.tropes.length > 0) {
    parts.push(filters.tropes.map(tropeDisplayName).join(", "));
  }
  if (filters.subgenre) parts.push(tropeDisplayName(filters.subgenre));
  if (filters.spiceMin !== null) parts.push(`${filters.spiceMin}+ spice`);
  if (filters.spiceMax !== null) parts.push(`spice ${filters.spiceMax} or less`);
  if (filters.ratingMin !== null) parts.push(`${filters.ratingMin}+ stars`);
  if (filters.standalone) parts.push("standalone");
  if (filters.trending) parts.push("trending");
  if (filters.moods.length > 0) parts.push(filters.moods.slice(0, 2).join(", "));

  return parts.length > 0 ? parts.join(" · ") : "Title, author, trope, or vibe";
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const query = searchParams.q ?? "";

  let books: BookDetail[] = [];
  let filters: SearchFilters | null = null;
  let intentType: string = "none";
  let analyticsId: string | null = null;

  if (query) {
    const startTime = Date.now();
    const intent = classifyQuery(query);
    intentType = intent.type;

    if (intent.type === "title_author") {
      books = await findBook(intent.query);
    } else if (intent.type === "video_url") {
      redirect(`/booktok?url=${encodeURIComponent(intent.url)}`);
    } else {
      // discovery / comparison / question → Haiku intent parsing
      try {
        filters = await parseSearchIntent(query, intent.type);

        // If Haiku couldn't extract structure, fall back to keyword
        if (
          filters.textQuery &&
          filters.tropes.length === 0 &&
          !filters.similarTo &&
          !filters.spiceMin &&
          !filters.spiceMax &&
          !filters.trending
        ) {
          books = await findBook(filters.textQuery);
          intentType = "title_author_fallback";
        } else {
          books = await executeFilteredSearch(filters);

          // Optionally rerank by DNA for logged-in users (relevance sort only)
          if (filters.sortBy === "relevance") {
            try {
              const supabaseAuth = createClient();
              const { data: { user } } = await supabaseAuth.auth.getUser();
              if (user) {
                const dna = await getDna(user.id);
                if (dna) {
                  books = reRankByDna(books, dna);
                }
              }
            } catch {
              // DNA reranking is best-effort
            }
          }
        }
      } catch (err) {
        console.warn("[search] Smart search failed, falling back:", err);
        books = await findBook(query);
        intentType = "title_author_fallback";
      }
    }

    const latencyMs = Date.now() - startTime;

    // Log analytics for all search types (fire-and-forget)
    analyticsId = randomUUID();
    logSearchAnalytics({
      id: analyticsId,
      queryText: query,
      intentType,
      filters,
      resultCount: books.length,
      latencyMs,
    });

    captureSearchDemand({
      query,
      intentType,
      books,
    }).catch((err) => {
      console.warn("[search] Failed to capture demand signal:", err);
    });
  }

  const isSmartSearch =
    filters &&
    intentType !== "title_author" &&
    intentType !== "title_author_fallback" &&
    intentType !== "none";

  // Non-null assertion safe: isSmartSearch already guarantees filters !== null
  const activeFilters = isSmartSearch ? filters : null;

  const hasFilterPills =
    activeFilters !== null &&
    (activeFilters.tropes.length > 0 ||
      activeFilters.spiceMin !== null ||
      activeFilters.spiceMax !== null ||
      activeFilters.ratingMin !== null ||
      activeFilters.similarTo !== null ||
      activeFilters.moods.length > 0 ||
      activeFilters.trending ||
      activeFilters.standalone ||
      activeFilters.subgenre !== null);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 sm:py-12">
      {query && (
        <header className="mb-5 border-b border-aged-gold/30 pb-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fire">
            Your next obsession
          </p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl font-bold text-ink">
            Results for &ldquo;{query}&rdquo;
          </h1>
          <div className="mt-4 grid gap-3 rounded-2xl border border-aged-gold/30 bg-white/70 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-fire/10 p-2 text-fire">
                {isSmartSearch ? (
                  <Sparkles size={16} aria-hidden="true" />
                ) : (
                  <Search size={16} aria-hidden="true" />
                )}
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted/70">
                  {isSmartSearch ? "Hotlist understood" : "Book search"}
                </p>
                <p className="mt-0.5 text-sm font-body text-ink">
                  {filterSummary(activeFilters)}
                </p>
              </div>
            </div>
            <p className="rounded-full bg-cream px-3 py-1.5 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-muted-a11y">
              {books.length} {books.length === 1 ? "match" : "matches"}
            </p>
          </div>
        </header>
      )}

      {/* ── Parsed filter pills + feedback ── */}
      {hasFilterPills && activeFilters && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono text-muted/60">Showing:</span>

          {activeFilters.tropes.map((slug) => (
            <Link
              key={slug}
              href={`/tropes/${slug}`}
              className="px-2.5 py-1 rounded-full text-xs font-mono bg-fire/10 border border-fire/30 text-fire hover:bg-fire/20 transition-colors"
            >
              {tropeDisplayName(slug)}
            </Link>
          ))}

          {activeFilters.spiceMin !== null && (
            <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-fire/10 border border-fire/30 text-fire">
              {activeFilters.spiceMin}+ spice
            </span>
          )}

          {activeFilters.spiceMax !== null && (
            <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-fire/10 border border-fire/30 text-fire">
              spice {activeFilters.spiceMax} or less
            </span>
          )}

          {activeFilters.ratingMin !== null && (
            <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-amber-50 border border-amber-200 text-amber-700">
              {activeFilters.ratingMin}+ rated
            </span>
          )}

          {activeFilters.similarTo && (
            <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-cream border border-border text-ink">
              Similar to {activeFilters.similarTo}
            </span>
          )}

          {activeFilters.subgenre && (
            <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-cream border border-border/60 text-muted/70">
              {activeFilters.subgenre}
            </span>
          )}

          {activeFilters.moods.map((mood) => (
            <span
              key={mood}
              className="px-2.5 py-1 rounded-full text-xs font-mono bg-cream border border-border/60 text-muted/70"
            >
              {mood}
            </span>
          ))}

          {activeFilters.standalone && (
            <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-cream border border-border/60 text-muted/70">
              standalone
            </span>
          )}

          {activeFilters.trending && (
            <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-fire/10 border border-fire/30 text-fire">
              trending
            </span>
          )}

          {activeFilters.sortBy !== "relevance" && (
            <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-cream border border-border/60 text-muted/60">
              sorted by {activeFilters.sortBy}
            </span>
          )}

          {/* Spacer pushes feedback to the right */}
          <span className="flex-1" />

          {analyticsId && <SearchFeedback analyticsId={analyticsId} />}
        </div>
      )}

      {!query && (
        <div className="mx-auto max-w-3xl py-14 text-center">
          <div className="mx-auto inline-flex rounded-full bg-fire/10 p-3 text-fire">
            <Sparkles size={22} aria-hidden="true" />
          </div>
          <p className="mt-5 font-display text-3xl font-bold text-ink">
            Search by title, trope, spice, or pure reader mood.
          </p>
          <p className="mx-auto mt-3 max-w-xl text-sm font-body leading-6 text-muted">
            Hotlist can handle normal book searches and softer requests like
            &ldquo;cozy romantasy with low spice&rdquo; or &ldquo;like ACOTAR but more
            grown up.&rdquo;
          </p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            {SEARCH_EXAMPLES.map((example) => (
              <Link
                key={example}
                href={`/search?q=${encodeURIComponent(example)}`}
                className="inline-flex min-h-12 items-center justify-between rounded-xl border border-aged-gold/30 bg-white px-4 py-3 text-left text-sm font-body text-ink shadow-sm transition-colors hover:border-fire/30 hover:bg-parchment"
              >
                <span>{example}</span>
                <span className="font-mono text-fire" aria-hidden="true">
                  &rarr;
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {query && books.length === 0 && (
        <div className="mx-auto max-w-2xl py-12 text-center">
          <div className="mx-auto inline-flex rounded-full bg-fire/10 p-3 text-fire">
            <SlidersHorizontal size={22} aria-hidden="true" />
          </div>
          <p className="mt-5 text-2xl font-display font-bold text-ink">
            {isSmartSearch
              ? "We couldn\u2019t find books matching all your criteria"
              : <>We don&apos;t have &ldquo;{query}&rdquo; yet</>}
          </p>
          <div className="mx-auto mt-4 max-w-lg text-sm font-body text-muted">
            {isSmartSearch ? (
              <p>
                Your search may be too specific for the books we have enriched
                so far. Loosen one filter, then add the book to your Hotlist
                once you find a promising match.
              </p>
            ) : (
              <p>
                Try a different spelling, just the author name, or a vibe like
                &ldquo;spicy fae enemies to lovers.&rdquo; If this is a real book,
                the request form below helps us prioritize it.
              </p>
            )}
          </div>
          <div className="mt-6 grid gap-2 sm:grid-cols-3">
            {(isSmartSearch
              ? ["spicy romantasy", "enemies to lovers", "highly rated romance"]
              : ["spicy fae enemies to lovers", "browse tropes", "popular romantasy"]
            ).map((suggestion) =>
              suggestion === "browse tropes" ? (
                <Link
                  key={suggestion}
                  href="/tropes"
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-3 py-2 text-xs font-mono uppercase tracking-[0.14em] text-muted-a11y transition-colors hover:border-fire/30 hover:text-fire"
                >
                  Browse tropes
                </Link>
              ) : (
                <Link
                  key={suggestion}
                  href={`/search?q=${encodeURIComponent(suggestion)}`}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-3 py-2 text-xs font-mono uppercase tracking-[0.14em] text-muted-a11y transition-colors hover:border-fire/30 hover:text-fire"
                >
                  {suggestion}
                </Link>
              )
            )}
          </div>
          <Link
            href="/booktok"
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full border border-fire/25 bg-fire/5 px-4 py-2 text-sm font-mono text-fire transition-colors hover:bg-fire/10"
          >
            <Video size={14} className="inline -mt-0.5" aria-hidden="true" />
            Paste a BookTok link to find books from a video &rarr;
          </Link>
          {!isSmartSearch && <MissingBookRequest initialTitle={query} />}
        </div>
      )}

      {books.length > 0 && (
        <div className="grid grid-cols-1 gap-px border-y border-aged-gold/30 bg-aged-gold/30 sm:grid-cols-2 lg:grid-cols-3">
          {books.map((book) => (
            <BookCard key={book.id} book={book} layout="list" />
          ))}
        </div>
      )}
    </div>
  );
}
