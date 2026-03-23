export const dynamic = "force-dynamic";

import { findBook } from "@/lib/books";
import { classifyQuery } from "@/lib/search/classify-query";
import { parseSearchIntent } from "@/lib/search/parse-intent";
import type { SearchFilters } from "@/lib/search/parse-intent";
import { executeFilteredSearch } from "@/lib/search/execute-filters";
import { logSearchAnalytics } from "@/lib/search/analytics";
import { Video } from "lucide-react";
import BookCard from "@/components/books/BookCard";
import SearchFeedback from "@/components/search/SearchFeedback";
import Link from "next/link";
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
      books = [];
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
    <div className="max-w-6xl mx-auto px-4 py-6">
      {query && (
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink mb-4">
          Results for &ldquo;{query}&rdquo;
        </h1>
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
        <div className="text-center py-16">
          <p className="text-lg font-body text-muted">
            Enter a search to find books
          </p>
        </div>
      )}

      {query && books.length === 0 && (
        <div className="text-center py-16 max-w-md mx-auto">
          <p className="text-lg font-display font-bold text-ink">
            {isSmartSearch
              ? "We couldn\u2019t find books matching all your criteria"
              : <>We don&apos;t have &ldquo;{query}&rdquo; yet</>}
          </p>
          <div className="mt-4 text-sm font-body text-muted space-y-1.5 text-left">
            {isSmartSearch ? (
              <p>Try being less specific, or search by title or author instead.</p>
            ) : (
              <>
                <p>Try searching for:</p>
                <ul className="list-disc list-inside space-y-1 text-muted/80">
                  <li>A different spelling</li>
                  <li>Just the author&apos;s name</li>
                  <li>A vibe like &ldquo;spicy fae enemies to lovers&rdquo;</li>
                  <li>
                    A trope instead &rarr;{" "}
                    <a
                      href="/tropes"
                      className="text-fire hover:text-fire/80 font-mono text-xs transition-colors"
                    >
                      browse tropes
                    </a>
                  </li>
                </ul>
              </>
            )}
          </div>
          <a
            href="/booktok"
            className="inline-flex items-center gap-2 mt-6 text-sm font-mono text-fire hover:text-fire/80 transition-colors"
          >
            <Video size={14} className="inline -mt-0.5" aria-hidden="true" />
            Paste a BookTok link to find books from a video &rarr;
          </a>
        </div>
      )}

      {books.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {books.map((book) => (
            <BookCard key={book.id} book={book} layout="list" />
          ))}
        </div>
      )}
    </div>
  );
}
