/**
 * GET /api/books/search?q={query}
 *
 * Returns romance-focused book search results.
 * Source: Supabase cache first, then Goodreads, then Google Books fallback.
 */

import { findBook } from "@/lib/books";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q");

  if (!query || query.trim().length < 2) {
    return NextResponse.json(
      { error: "Query must be at least 2 characters" },
      { status: 400 }
    );
  }

  try {
    const books = await findBook(query);

    // Shape results for the frontend — keep it lean for search
    const results = books.map((book) => {
      const rated = book.ratings.filter((r) => r.rating !== null);
      const averageRating =
        rated.length > 0
          ? rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length
          : null;

      const goodreadsRating =
        book.ratings.find((r) => r.source === "goodreads")?.rating ?? null;

      const topSpice = book.spice.length > 0
        ? book.spice.reduce((max, s) => (s.spiceLevel > max.spiceLevel ? s : max), book.spice[0])
        : null;

      return {
        id: book.id,
        goodreadsId: book.goodreadsId,
        title: book.title,
        author: book.author,
        slug: book.slug,
        coverUrl: book.coverUrl,
        seriesName: book.seriesName,
        seriesPosition: book.seriesPosition,
        averageRating: averageRating ? parseFloat(averageRating.toFixed(2)) : null,
        goodreadsRating,
        spiceLevel: topSpice?.spiceLevel ?? null,
        spiceSource: topSpice?.source ?? null,
        topTropes: book.tropes.slice(0, 3).map((t) => t.name),
        subgenre: book.subgenre,
      };
    });

    // Determine the source for debugging
    const source = books.length > 0 && books[0].metadataSource === "goodreads"
      ? "goodreads"
      : books.length > 0
        ? "cache"
        : "none";

    return NextResponse.json({
      query,
      source,
      total: results.length,
      books: results,
    });
  } catch (err) {
    console.error("Book search failed:", err);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
