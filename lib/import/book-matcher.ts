import { getAdminClient } from "@/lib/supabase/admin";
import type { GoodreadsImport } from "./goodreads-csv";
import type { ReaderResponse } from "@/lib/types";

export interface MatchedBook {
  importIndex: number;
  bookId: string | null;
  title: string;
  author: string;
  coverUrl: string | null;
  matchMethod: "goodreads_id" | "isbn13" | "isbn" | "title_author" | "unmatched";
  proposedResponse: ReaderResponse;
  goodreadsImport: GoodreadsImport;
}

/**
 * Match a batch of Goodreads imports against the local books table.
 * Tries: (1) goodreads_id, (2) ISBN13, (3) ISBN10, (4) title+author exact.
 * Unmatched books get bookId: null — they can still have responses applied
 * after being provisioned via Google Books.
 */
export async function matchImportedBooks(
  imports: GoodreadsImport[]
): Promise<MatchedBook[]> {
  const supabase = getAdminClient();
  const results: MatchedBook[] = [];

  // Collect all identifiers for batch lookup
  const grIds = imports
    .map((b) => b.goodreadsId)
    .filter((id): id is string => !!id && id !== "");
  const isbn13s = imports
    .map((b) => b.isbn13)
    .filter((v): v is string => !!v);
  const isbns = imports
    .map((b) => b.isbn)
    .filter((v): v is string => !!v);

  // Batch fetch by goodreads_id
  const grMap = new Map<string, { id: string; cover_url: string | null }>();
  if (grIds.length > 0) {
    const { data: grBooks } = await supabase
      .from("books")
      .select("id, goodreads_id, cover_url")
      .in("goodreads_id", grIds);
    for (const b of grBooks ?? []) {
      grMap.set(b.goodreads_id as string, {
        id: b.id as string,
        cover_url: b.cover_url as string | null,
      });
    }
  }

  // Batch fetch by isbn13
  const isbn13Map = new Map<string, { id: string; cover_url: string | null }>();
  if (isbn13s.length > 0) {
    const { data: isbnBooks } = await supabase
      .from("books")
      .select("id, isbn13, cover_url")
      .in("isbn13", isbn13s);
    for (const b of isbnBooks ?? []) {
      isbn13Map.set(b.isbn13 as string, {
        id: b.id as string,
        cover_url: b.cover_url as string | null,
      });
    }
  }

  // Batch fetch by isbn
  const isbnMap = new Map<string, { id: string; cover_url: string | null }>();
  if (isbns.length > 0) {
    const { data: isbnBooks } = await supabase
      .from("books")
      .select("id, isbn, cover_url")
      .in("isbn", isbns);
    for (const b of isbnBooks ?? []) {
      isbnMap.set(b.isbn as string, {
        id: b.id as string,
        cover_url: b.cover_url as string | null,
      });
    }
  }

  for (let i = 0; i < imports.length; i++) {
    const imp = imports[i];
    let bookId: string | null = null;
    let coverUrl: string | null = null;
    let matchMethod: MatchedBook["matchMethod"] = "unmatched";

    // Try goodreads_id first
    if (imp.goodreadsId) {
      const match = grMap.get(imp.goodreadsId);
      if (match) {
        bookId = match.id;
        coverUrl = match.cover_url;
        matchMethod = "goodreads_id";
      }
    }

    // Try ISBN13
    if (!bookId && imp.isbn13) {
      const match = isbn13Map.get(imp.isbn13);
      if (match) {
        bookId = match.id;
        coverUrl = match.cover_url;
        matchMethod = "isbn13";
      }
    }

    // Try ISBN
    if (!bookId && imp.isbn) {
      const match = isbnMap.get(imp.isbn);
      if (match) {
        bookId = match.id;
        coverUrl = match.cover_url;
        matchMethod = "isbn";
      }
    }

    // Try title+author fuzzy match (only for unmatched so far)
    if (!bookId) {
      const normalizedTitle = imp.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
      const authorLast = imp.author.split(/\s+/).pop()?.toLowerCase() ?? "";
      if (normalizedTitle && authorLast) {
        const { data: fuzzyMatch } = await supabase
          .from("books")
          .select("id, cover_url")
          .ilike("title", `%${normalizedTitle.split(/\s+/).slice(0, 4).join("%")}%`)
          .ilike("author", `%${authorLast}%`)
          .limit(1)
          .single();
        if (fuzzyMatch) {
          bookId = fuzzyMatch.id as string;
          coverUrl = fuzzyMatch.cover_url as string | null;
          matchMethod = "title_author";
        }
      }
    }

    results.push({
      importIndex: i,
      bookId,
      title: imp.title,
      author: imp.author,
      coverUrl,
      matchMethod,
      proposedResponse: mapRatingToResponse(imp.rating, imp.shelf),
      goodreadsImport: imp,
    });
  }

  return results;
}

/**
 * Map a Goodreads rating + shelf to a ReaderResponse.
 *
 * - GR 4-5 → loved_it
 * - GR 3 → it_was_fine
 * - GR 1-2 → didnt_finish
 * - "to-read" shelf → must_read (optimistic — they want to read it)
 * - "currently-reading" → on_the_shelf
 * - Unrated + "read" shelf → it_was_fine (they read it but didn't rate)
 */
function mapRatingToResponse(
  rating: number | null,
  shelf: string
): ReaderResponse {
  if (rating && rating >= 4) return "loved_it";
  if (rating === 3) return "it_was_fine";
  if (rating && rating <= 2) return "didnt_finish";

  if (shelf === "to-read") return "must_read";
  if (shelf === "currently-reading") return "on_the_shelf";
  if (shelf === "read") return "it_was_fine";

  return "on_the_shelf";
}
