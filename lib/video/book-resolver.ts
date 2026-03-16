/**
 * Book Resolver — type definitions for resolved book results.
 *
 * The actual resolution logic now lives in the Sonnet book agent (book-agent.ts),
 * which searches and confirms books on Goodreads via tool use.
 */

import type { BookDetail } from "@/lib/types";

export interface ResolvedBookMatched {
  matched: true;
  book: BookDetail;
  creatorSentiment: string;
  creatorQuote: string;
  confidence: "high" | "medium";
}

export interface ResolvedBookUnmatched {
  matched: false;
  rawTitle: string;
  rawAuthor: string | null;
  creatorSentiment: string;
  creatorQuote: string;
  confidence: "high" | "medium";
}

export type ResolvedBook = ResolvedBookMatched | ResolvedBookUnmatched;
