import type { BookDetail } from "@/lib/types";
import { recordDiscoveryCandidate } from "@/lib/books/discovery-candidates";

const MIN_QUERY_LENGTH = 4;
const MAX_QUERY_LENGTH = 120;

const NON_TITLE_PATTERNS =
  /\b(books?\s+like|similar\s+to|recommend|recommendations?|spicy|spice|trope|tropes|enemies\s+to\s+lovers|forced\s+proximity|slow\s+burn|what\s+should\s+i\s+read|find\s+me|show\s+me)\b/i;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasStrongResult(query: string, books: BookDetail[]): boolean {
  const normalizedQuery = normalize(query);

  return books.some((book) => {
    const title = normalize(book.title);
    const titleAuthor = normalize(`${book.title} ${book.author}`);

    return (
      title === normalizedQuery ||
      titleAuthor === normalizedQuery ||
      title.startsWith(normalizedQuery) ||
      normalizedQuery.startsWith(title)
    );
  });
}

function hasAuthorMatch(query: string, books: BookDetail[]): boolean {
  const normalizedQuery = normalize(query);
  return books.some((book) => normalize(book.author) === normalizedQuery);
}

export async function captureSearchDemand(params: {
  query: string;
  intentType: string;
  books: BookDetail[];
}): Promise<void> {
  const query = params.query.trim();
  if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH) return;

  if (
    params.intentType !== "title_author" &&
    params.intentType !== "title_author_fallback"
  ) {
    return;
  }

  if (NON_TITLE_PATTERNS.test(query)) return;
  if (hasStrongResult(query, params.books)) return;
  if (hasAuthorMatch(query, params.books)) return;

  const demandScore = params.books.length === 0 ? 95 : 70;

  await recordDiscoveryCandidate({
    title: query,
    source: "user_search_miss",
    category: params.books.length === 0 ? "no_results" : "weak_results",
    demandScore,
    metadata: {
      intent_type: params.intentType,
      result_count: params.books.length,
    },
  });
}
