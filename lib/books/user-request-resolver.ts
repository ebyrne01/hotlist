import { getAdminClient } from "@/lib/supabase/admin";
import type { Book, BookData } from "@/lib/types";
import { getGoodreadsBookById } from "@/lib/books/goodreads-search";
import {
  resolveExistingBook,
  saveGoodreadsBookToCache,
  saveProvisionalBook,
} from "@/lib/books/cache";
import { searchGoogleBooks } from "@/lib/books/google-books";
import { externalIdsFromUrl, providerFromUrl } from "@/lib/books/source-url";

type ExternalIds = {
  goodreads_id?: string;
  asin?: string;
  romance_io_slug?: string;
};

type DiscoveryCandidateRow = {
  id: string;
  title: string;
  author: string | null;
  source_url: string | null;
  metadata: Record<string, unknown> | null;
};

export interface BookRequestResolveResult {
  status: "resolved" | "ignored";
  bookId: string | null;
  reason: string;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleOverlap(a: string, b: string): number {
  const aWords = new Set(normalize(a).split(" ").filter((word) => word.length > 2));
  const bWords = normalize(b).split(" ").filter((word) => word.length > 2);
  if (bWords.length === 0) return 0;
  return bWords.filter((word) => aWords.has(word)).length / bWords.length;
}

function getExternalIds(candidate: DiscoveryCandidateRow): ExternalIds {
  const fromMetadata =
    (candidate.metadata?.external_ids as ExternalIds | undefined) ?? {};

  if (!candidate.source_url) return fromMetadata;

  try {
    return {
      ...externalIdsFromUrl(new URL(candidate.source_url)),
      ...fromMetadata,
    };
  } catch {
    return fromMetadata;
  }
}

function metadataWithResolution(
  candidate: DiscoveryCandidateRow,
  patch: Record<string, unknown>
) {
  return {
    ...(candidate.metadata ?? {}),
    resolver: {
      ...((candidate.metadata?.resolver as Record<string, unknown> | undefined) ?? {}),
      ...patch,
      resolved_at: new Date().toISOString(),
    },
  };
}

async function markCandidate(
  candidate: DiscoveryCandidateRow,
  result: BookRequestResolveResult
) {
  const supabase = getAdminClient();
  await supabase
    .from("discovery_candidates")
    .update({
      status: result.status === "resolved" ? "resolved" : result.status,
      resolved_book_id: result.bookId,
      metadata: metadataWithResolution(candidate, {
        status: result.status,
        reason: result.reason,
        book_id: result.bookId,
      }),
    })
    .eq("id", candidate.id);
}

function mapGoodreadsDetailToBookData(
  detail: NonNullable<Awaited<ReturnType<typeof getGoodreadsBookById>>>,
  ids: ExternalIds
): BookData {
  return {
    goodreadsId: detail.goodreadsId,
    goodreadsUrl: detail.goodreadsUrl,
    title: detail.title,
    author: detail.author,
    coverUrl: detail.coverUrl,
    description: detail.description,
    pageCount: detail.pageCount,
    publishedYear: detail.publishedYear,
    genres: detail.genres,
    seriesName: detail.seriesName,
    seriesPosition: detail.seriesPosition,
    amazonAsin: ids.asin ?? null,
    romanceIoSlug: ids.romance_io_slug ?? null,
  };
}

async function findGoogleFallback(
  title: string,
  author: string | null,
  ids: ExternalIds
): Promise<BookData | null> {
  const query = author ? `${title} ${author}` : title;
  const results = await searchGoogleBooks(query);
  const strongMatch = results.find((book) => {
    if (titleOverlap(book.title, title) < 0.75) return false;
    if (!author) return true;
    return normalize(book.author).includes(normalize(author).split(" ").at(-1) ?? "");
  });

  const book = strongMatch ?? results[0] ?? null;
  if (!book) return null;

  return {
    ...book,
    amazonAsin: ids.asin ?? book.amazonAsin ?? null,
    romanceIoSlug: ids.romance_io_slug ?? book.romanceIoSlug ?? null,
  };
}

async function resolveCandidate(
  candidate: DiscoveryCandidateRow
): Promise<BookRequestResolveResult> {
  const ids = getExternalIds(candidate);

  if (ids.goodreads_id) {
    const existing = await resolveExistingBook({
      goodreadsId: ids.goodreads_id,
      title: candidate.title,
      author: candidate.author ?? "",
    });
    if (existing) {
      return {
        status: "resolved",
        bookId: existing,
        reason: "matched_existing_goodreads_id",
      };
    }

    const detail = await getGoodreadsBookById(ids.goodreads_id);
    if (detail) {
      const saved = await saveGoodreadsBookToCache(
        mapGoodreadsDetailToBookData(detail, ids)
      );
      if (saved) {
        return {
          status: "resolved",
          bookId: saved.id,
          reason: "created_from_goodreads_url",
        };
      }
    }
  }

  const googleFallback = await findGoogleFallback(
    candidate.title,
    candidate.author,
    ids
  );

  const bookData: BookData | null =
    googleFallback ??
    (candidate.author
      ? {
          title: candidate.title,
          author: candidate.author,
          amazonAsin: ids.asin ?? null,
          romanceIoSlug: ids.romance_io_slug ?? null,
        }
      : null);

  if (!bookData) {
    return {
      status: "ignored",
      bookId: null,
      reason: "insufficient_metadata",
    };
  }

  const existing = await resolveExistingBook({
    goodreadsId: bookData.goodreadsId ?? null,
    isbn: bookData.isbn ?? null,
    isbn13: bookData.isbn13 ?? null,
    googleBooksId: bookData.googleBooksId ?? null,
    title: bookData.title,
    author: bookData.author,
  });
  if (existing) {
    return {
      status: "resolved",
      bookId: existing,
      reason: "matched_existing_title_author",
    };
  }

  const saved: Book | null = await saveProvisionalBook(bookData);
  if (saved) {
    return {
      status: "resolved",
      bookId: saved.id,
      reason: googleFallback ? "created_from_google_books" : "created_provisional_from_submission",
    };
  }

  return {
    status: "ignored",
    bookId: null,
    reason: "provisional_save_rejected",
  };
}

export async function resolveBookRequestCandidate(
  candidateId: string
): Promise<BookRequestResolveResult | null> {
  const supabase = getAdminClient();
  const { data: candidate, error } = await supabase
    .from("discovery_candidates")
    .select("id, title, author, source_url, metadata")
    .eq("id", candidateId)
    .single();

  if (error || !candidate) {
    console.warn("[book-request-resolver] Candidate lookup failed:", error?.message);
    return null;
  }

  const result = await resolveCandidate(candidate as DiscoveryCandidateRow);
  await markCandidate(candidate as DiscoveryCandidateRow, result);
  return result;
}

export async function processBookRequestCandidates(limit = 10): Promise<{
  processed: number;
  resolved: number;
  ignored: number;
  results: BookRequestResolveResult[];
}> {
  const supabase = getAdminClient();
  const { data: candidates, error } = await supabase
    .from("discovery_candidates")
    .select("id, title, author, source_url, metadata")
    .eq("source", "user_submitted_url")
    .eq("status", "new")
    .order("demand_score", { ascending: false })
    .order("last_seen_at", { ascending: true })
    .limit(limit);

  if (error || !candidates) {
    console.warn("[book-request-resolver] Candidate fetch failed:", error?.message);
    return { processed: 0, resolved: 0, ignored: 0, results: [] };
  }

  const results: BookRequestResolveResult[] = [];
  for (const candidate of candidates as DiscoveryCandidateRow[]) {
    let provider = "external_url";
    if (candidate.source_url) {
      try {
        provider = providerFromUrl(new URL(candidate.source_url));
      } catch {
        provider = "external_url";
      }
    }
    console.log(
      `[book-request-resolver] Resolving "${candidate.title}" from ${provider}`
    );
    const result = await resolveCandidate(candidate);
    await markCandidate(candidate, result);
    results.push(result);
  }

  return {
    processed: results.length,
    resolved: results.filter((result) => result.status === "resolved").length,
    ignored: results.filter((result) => result.status === "ignored").length,
    results,
  };
}
