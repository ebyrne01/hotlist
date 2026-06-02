import { describe, expect, it } from "vitest";
import {
  getHighIntentBuzzScores,
  isFeaturedGenreBook,
  rankFeaturedGenreBooks,
} from "../featured-shelf";
import type { BookDetail } from "@/lib/types";

const NOW = new Date("2026-06-02T12:00:00Z");

function book(overrides: Partial<BookDetail>): BookDetail {
  return {
    id: "book-id",
    isbn: null,
    isbn13: null,
    googleBooksId: null,
    title: "Test Book",
    author: "Test Author",
    seriesName: null,
    seriesPosition: null,
    coverUrl: "https://example.com/cover.jpg",
    pageCount: null,
    publishedYear: 2026,
    publisher: null,
    description: null,
    aiSynopsis: null,
    goodreadsId: null,
    goodreadsUrl: null,
    amazonAsin: null,
    romanceIoSlug: null,
    romanceIoHeatLabel: null,
    booktrackPrompt: null,
    booktrackMoods: null,
    spotifyPlaylists: null,
    genres: ["romantasy", "fantasy romance"],
    subgenre: "romantasy",
    metadataSource: "goodreads",
    slug: "test-book",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    dataRefreshedAt: null,
    enrichmentStatus: "complete",
    isAudiobook: false,
    ratings: [],
    spice: [],
    compositeSpice: null,
    tropes: [],
    ...overrides,
  };
}

describe("featured shelf ranking", () => {
  it("excludes legacy low-rated YA/paranormal blockbusters from romantasy shelf lead", () => {
    const twilight = book({
      id: "twilight",
      title: "Twilight",
      publishedYear: 2005,
      genres: ["fantasy", "young adult", "romance", "vampires", "paranormal romance"],
      ratings: [
        { source: "goodreads", rating: 3.68, ratingCount: 7_423_951 },
        { source: "amazon", rating: 4.0, ratingCount: 0 },
        { source: "romance_io", rating: 3.3, ratingCount: null },
      ],
      tropes: [{ id: "vampire", slug: "vampire", name: "Vampire", description: null }],
    });

    expect(isFeaturedGenreBook(twilight, "romantasy", 0, NOW)).toBe(false);
  });

  it("keeps verified hot and new romantasy titles", () => {
    const hot = book({
      id: "hot",
      title: "Quicksilver",
      publishedYear: 2024,
      ratings: [{ source: "amazon", rating: 4.6, ratingCount: null }],
      tropes: [{ id: "fae", slug: "fae-faerie", name: "Fae / Faerie", description: null }],
    });
    const fresh = book({
      id: "fresh",
      title: "The New Dragon Book",
      publishedYear: 2026,
      ratings: [],
      tropes: [{ id: "dragon", slug: "dragon-riders", name: "Dragon Riders", description: null }],
    });

    expect(isFeaturedGenreBook(hot, "romantasy", 0, NOW)).toBe(true);
    expect(isFeaturedGenreBook(fresh, "romantasy", 0, NOW)).toBe(true);
  });

  it("excludes new romantasy rows that are not shelf-ready yet", () => {
    const emptyNewRelease = book({
      id: "empty-new",
      title: "The Empty New Book",
      publishedYear: 2026,
      ratings: [],
      tropes: [],
      compositeSpice: null,
      romanceIoSlug: null,
    });

    expect(isFeaturedGenreBook(emptyNewRelease, "romantasy", 0, NOW)).toBe(false);
    expect(isFeaturedGenreBook(emptyNewRelease, "romantasy", 1, NOW)).toBe(false);
  });

  it("excludes books whose only hot signal is hidden from shelf cards", () => {
    const hiddenAmazonOnly = book({
      id: "hidden-amazon",
      title: "A Blank Hot Card",
      publishedYear: 2026,
      ratings: [{ source: "amazon", rating: 4.8, ratingCount: 1_000 }],
      tropes: [],
      compositeSpice: null,
    });

    expect(isFeaturedGenreBook(hiddenAmazonOnly, "romantasy", 0, NOW)).toBe(false);
  });

  it("uses high-intent buzz, not generic reddit mentions, as a hot shelf signal", () => {
    const scores = getHighIntentBuzzScores([
      { book_id: "twilight", source: "reddit_mention" },
      { book_id: "fourth-wing", source: "booktok_grab" },
      { book_id: "onyx-storm", source: "amazon_bestseller" },
    ]);

    expect(scores.get("twilight")).toBeUndefined();
    expect(scores.get("fourth-wing")).toBe(1);
    expect(scores.get("onyx-storm")).toBe(1);
  });

  it("ranks eligible titles ahead of ineligible legacy titles", () => {
    const twilight = book({
      id: "twilight",
      title: "Twilight",
      publishedYear: 2005,
      ratings: [{ source: "goodreads", rating: 3.68, ratingCount: 7_423_951 }],
      tropes: [{ id: "vampire", slug: "vampire", name: "Vampire", description: null }],
    });
    const fourthWing = book({
      id: "fourth-wing",
      title: "Fourth Wing",
      publishedYear: 2023,
      ratings: [{ source: "goodreads", rating: 4.5, ratingCount: 2_000_000 }],
      tropes: [{ id: "dragon", slug: "dragon-riders", name: "Dragon Riders", description: null }],
    });

    expect(rankFeaturedGenreBooks([twilight, fourthWing], "romantasy", new Map(), NOW))
      .toEqual([fourthWing]);
  });
});
