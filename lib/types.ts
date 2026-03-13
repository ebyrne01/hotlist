// ────────────────────────────────────────────────────
// Core data types for Hotlist
// ────────────────────────────────────────────────────

export interface Book {
  id: string;
  isbn: string | null;
  isbn13: string | null;
  googleBooksId: string | null;
  title: string;
  author: string;
  seriesName: string | null;
  seriesPosition: number | null;
  coverUrl: string | null;
  pageCount: number | null;
  publishedYear: number | null;
  publisher: string | null;
  description: string | null;
  aiSynopsis: string | null;
  goodreadsId: string | null;
  goodreadsUrl: string | null;
  amazonAsin: string | null;
  romanceIoSlug: string | null;
  romanceIoHeatLabel: string | null;
  genres: string[];
  subgenre: string | null;
  metadataSource: "goodreads" | "google_books" | "open_library" | "manual";
  slug: string;
  createdAt: string;
  updatedAt: string;
  dataRefreshedAt: string | null;
  enrichmentStatus: "pending" | "partial" | "complete" | null;
}

export interface Rating {
  source: "goodreads" | "amazon" | "romance_io";
  rating: number | null;
  ratingCount: number | null;
}

export interface SpiceRating {
  source: "romance_io" | "hotlist_community" | "goodreads_inference";
  spiceLevel: number;
  ratingCount: number;
  confidence?: "low" | "medium" | "high";
}

export interface Trope {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

export type SpiceSource =
  | "community"
  | "romance_io"
  | "review_classifier"
  | "llm_inference"
  | "genre_bucketing";

export interface CompositeSpiceData {
  score: number;
  primarySource: SpiceSource;
  communityCount: number | null;
  signalCount: number;
  confidence: number;
  attribution: string;
  conflictFlag: boolean;
}

export interface BookDetail extends Book {
  ratings: Rating[];
  spice: SpiceRating[];
  compositeSpice: CompositeSpiceData | null;
  tropes: Trope[];
}

export interface Hotlist {
  id: string;
  userId: string;
  name: string;
  isPublic: boolean;
  shareSlug: string | null;
  createdAt: string;
  updatedAt: string;
  books: HotlistBook[];
}

export interface HotlistBook {
  id: string;
  hotlistId: string;
  bookId: string;
  position: number;
  addedAt: string;
  book: Book;
}

/** Full hotlist with hydrated BookDetail (ratings, spice, tropes) for each book */
export interface HotlistDetail {
  id: string;
  userId: string;
  name: string;
  isPublic: boolean;
  shareSlug: string | null;
  createdAt: string;
  updatedAt: string;
  ownerName: string | null;
  ownerAffiliateTag: string | null;
  books: HotlistBookDetail[];
}

export interface HotlistBookDetail {
  id: string;
  bookId: string;
  position: number;
  addedAt: string;
  book: BookDetail;
  userRating: UserRating | null;
}

export interface UserRating {
  starRating: number | null;
  spiceRating: number | null;
  note: string | null;
}

export type ReadingStatus = "want_to_read" | "reading" | "read";

// Shape used when mapping from external APIs before saving to DB
export interface BookData {
  isbn?: string | null;
  isbn13?: string | null;
  googleBooksId?: string | null;
  title: string;
  author: string;
  seriesName?: string | null;
  seriesPosition?: number | null;
  coverUrl?: string | null;
  pageCount?: number | null;
  publishedYear?: number | null;
  publisher?: string | null;
  description?: string | null;
  goodreadsId?: string | null;
  goodreadsUrl?: string | null;
  amazonAsin?: string | null;
  romanceIoSlug?: string | null;
  romanceIoHeatLabel?: string | null;
  genres?: string[];
  subgenre?: string | null;
}
