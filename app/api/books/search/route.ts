/**
 * GET /api/books/search?q={query}
 *
 * Unified search pipeline:
 * - title/author queries → existing FTS (fast, free)
 * - discovery/comparison/question queries → Haiku intent parsing → structured filters
 * - video URLs → redirect signal for client
 */

import { findBook } from "@/lib/books";
import { classifyQuery } from "@/lib/search/classify-query";
import { parseSearchIntent } from "@/lib/search/parse-intent";
import { executeFilteredSearch } from "@/lib/search/execute-filters";
import { createClient } from "@/lib/supabase/server";
import { getDna } from "@/lib/reading-dna";
import { reRankByDna } from "@/lib/reading-dna/score";
import type { BookDetail } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { isPublicSearchSuppressedTitle } from "@/lib/books/utils";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q");
  const mode = request.nextUrl.searchParams.get("mode");

  if (!query || query.trim().length < 2) {
    return NextResponse.json(
      { error: "Query must be at least 2 characters" },
      { status: 400 }
    );
  }

  try {
    const intent = classifyQuery(query);

    // ── Fast path: title/author → existing keyword search ──
    if (intent.type === "title_author") {
      const books = await findBook(intent.query);
      const shapedBooks = shapeResults(books, query);
      return NextResponse.json({
        query,
        intent: "title_author",
        total: shapedBooks.length,
        books: shapedBooks,
      });
    }

    // ── Video URL → redirect signal ──
    if (intent.type === "video_url") {
      return NextResponse.json({
        query,
        intent: "video_url",
        redirect: `/booktok?url=${encodeURIComponent(intent.url)}`,
      });
    }

    // Typeahead / quick search should stay fast and free. Smart natural-language
    // parsing happens on the full /search page after the reader submits.
    if (mode === "quick") {
      const books = await findBook(query);
      const shapedBooks = shapeResults(books, query);
      return NextResponse.json({
        query,
        intent: "quick",
        total: shapedBooks.length,
        books: shapedBooks,
      });
    }

    // ── Smart path: discovery/comparison/question → Haiku ──
    const filters = await parseSearchIntent(query, intent.type);

    // If Haiku couldn't extract structure, fall back to keyword search
    if (
      filters.textQuery &&
      filters.tropes.length === 0 &&
      !filters.similarTo &&
      !filters.spiceMin &&
      !filters.spiceMax &&
      !filters.trending
    ) {
      const books = await findBook(filters.textQuery);
      const shapedBooks = shapeResults(books, query);
      return NextResponse.json({
        query,
        intent: "title_author_fallback",
        total: shapedBooks.length,
        books: shapedBooks,
      });
    }

    let results = await executeFilteredSearch(filters);

    // Optionally rerank by DNA for logged-in users (relevance sort only)
    if (filters.sortBy === "relevance") {
      try {
        const supabaseAuth = createClient();
        const { data: { user } } = await supabaseAuth.auth.getUser();
        if (user) {
          const dna = await getDna(user.id);
          if (dna) {
            results = reRankByDna(results, dna);
          }
        }
      } catch {
        // DNA reranking is best-effort — don't break search if it fails
      }
    }

    const shapedBooks = shapeResults(results, query);
    return NextResponse.json({
      query,
      intent: intent.type,
      filters,
      total: shapedBooks.length,
      books: shapedBooks,
    });
  } catch (err) {
    // If anything in the smart path fails, fall back to keyword search
    console.warn("[search] Smart search failed, falling back to keyword:", err);
    try {
      const books = await findBook(query);
      const shapedBooks = shapeResults(books, query);
      return NextResponse.json({
        query,
        intent: "title_author_fallback",
        total: shapedBooks.length,
        books: shapedBooks,
      });
    } catch (fallbackErr) {
      console.error("Book search failed completely:", fallbackErr);
      return NextResponse.json(
        { error: "Search failed" },
        { status: 500 }
      );
    }
  }
}

/** Shape BookDetail[] into the lean search result format for the frontend */
function shapeResults(books: BookDetail[], query: string) {
  const seenTitles = new Set<string>();

  return books
    .map((book) => {
      const goodreadsRating =
        book.ratings.find((r) => r.source === "goodreads")?.rating ?? null;

      return {
        id: book.id,
        goodreadsId: book.goodreadsId,
        title: book.title,
        author: book.author,
        slug: book.slug,
        coverUrl: book.coverUrl,
        seriesName: book.seriesName,
        seriesPosition: book.seriesPosition,
        goodreadsRating,
        ratingCount:
          book.ratings.find((r) => r.source === "goodreads")?.ratingCount ??
          null,
        spiceLevel: book.compositeSpice?.score ?? null,
        topTropes: book.tropes.slice(0, 3).map((t) => t.name),
        subgenre: book.subgenre,
      };
    })
    .filter((r) => !isPublicSearchSuppressedTitle(r.title))
    .filter((r) => {
      // Deduplicate by normalized title+author
      const key = `${r.title.toLowerCase().replace(/[^\w\s]/g, "").trim()}::${r.author.toLowerCase().trim()}`;
      if (seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    })
    .sort((a, b) => searchResultScore(b, query) - searchResultScore(a, query));
}

function searchResultScore(
  result: {
    title: string;
    author: string;
    seriesName: string | null;
    goodreadsRating: number | null;
    ratingCount: number | null;
  },
  query: string
) {
  const normalizedQuery = normalizeSearchText(query);
  const words = normalizedQuery
    .split(/\s+/)
    .filter((word) => word.length > 1 && !SEARCH_STOP_WORDS.has(word));

  const titleText = normalizeSearchText(`${result.title} ${result.seriesName ?? ""}`);
  const authorText = normalizeSearchText(result.author);

  let score = 0;
  if (titleText === normalizedQuery) score += 300;
  if (titleText.startsWith(normalizedQuery)) score += 240;
  if (titleText.includes(normalizedQuery)) score += 220;

  const titleMatches = words.filter((word) => titleText.includes(word)).length;
  const authorMatches = words.filter((word) => authorText.includes(word)).length;

  score += titleMatches * 60;
  score += authorMatches * 25;
  if (titleMatches > 0 && authorMatches > 0) score += 60;
  if (titleMatches >= Math.min(2, words.length)) score += 30;

  score += Math.min((result.ratingCount ?? 0) / 100_000, 10);
  if (result.goodreadsRating) score += 2;

  return score;
}

const SEARCH_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "by",
  "book",
  "novel",
]);

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
