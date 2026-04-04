/**
 * Shared book query parameters.
 *
 * This type gives a name to the implicit interface that the filter
 * functions already share. Only includes fields with current consumers.
 * Extend when new consumers (Ash, Mood Match) have real requirements.
 */
export interface BookQuery {
  tropes?: string[];
  excludeTropes?: string[];
  spiceMin?: number;
  spiceMax?: number;
  ratingMin?: number;
  similarToBookId?: string;
  similarToTitle?: string; // resolved to ID internally
  excludeBookIds?: string[];
  standalone?: boolean;
  trending?: boolean;
  sortBy?: "relevance" | "rating" | "spice" | "buzz" | "newest";
  textQuery?: string;
  limit?: number; // default 30
}
