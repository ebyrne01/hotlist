import type { BookData } from "@/lib/types";

interface OLSearchDoc {
  key: string;
  title: string;
  author_name?: string[];
  isbn?: string[];
  cover_i?: number;
  number_of_pages_median?: number;
  first_publish_year?: number;
  publisher?: string[];
}

interface OLBookData {
  title?: string;
  authors?: { name: string }[];
  number_of_pages?: number;
  publish_date?: string;
  publishers?: { name: string }[];
  cover?: { medium?: string; large?: string };
  subjects?: { name: string }[];
}

function mapSearchDoc(doc: OLSearchDoc): BookData {
  const isbn13 = doc.isbn?.find((i) => i.length === 13) ?? null;
  const isbn10 = doc.isbn?.find((i) => i.length === 10) ?? null;

  const coverUrl = doc.cover_i
    ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
    : null;

  return {
    title: doc.title,
    author: doc.author_name?.join(", ") ?? "Unknown Author",
    isbn: isbn10,
    isbn13,
    coverUrl,
    pageCount: doc.number_of_pages_median ?? null,
    publishedYear: doc.first_publish_year ?? null,
    publisher: doc.publisher?.[0] ?? null,
    description: null,
  };
}

export async function searchOpenLibrary(query: string): Promise<BookData[]> {
  const params = new URLSearchParams({
    q: query,
    limit: "10",
  });

  const res = await fetch(`https://openlibrary.org/search.json?${params}`);
  if (!res.ok) return [];

  const data = await res.json();
  const docs: OLSearchDoc[] = data.docs ?? [];

  return docs
    .filter((doc) => doc.title)
    .map(mapSearchDoc);
}

export async function getOpenLibraryByISBN(isbn: string): Promise<BookData | null> {
  const res = await fetch(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`
  );
  if (!res.ok) return null;

  const data = await res.json();
  const entry: OLBookData | undefined = data[`ISBN:${isbn}`];
  if (!entry) return null;

  const year = entry.publish_date
    ? parseInt(entry.publish_date, 10) || null
    : null;

  return {
    title: entry.title ?? "Unknown Title",
    author: entry.authors?.map((a) => a.name).join(", ") ?? "Unknown Author",
    isbn: isbn.length === 10 ? isbn : null,
    isbn13: isbn.length === 13 ? isbn : null,
    coverUrl: entry.cover?.medium ?? entry.cover?.large ?? null,
    pageCount: entry.number_of_pages ?? null,
    publishedYear: year,
    publisher: entry.publishers?.[0]?.name ?? null,
    description: null,
  };
}
