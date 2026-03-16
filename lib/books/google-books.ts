import type { BookData } from "@/lib/types";

const BASE_URL = "https://www.googleapis.com/books/v1/volumes";

interface GoogleVolume {
  id: string;
  volumeInfo: {
    title?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    industryIdentifiers?: { type: string; identifier: string }[];
    pageCount?: number;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
}

function mapVolume(vol: GoogleVolume): BookData {
  const info = vol.volumeInfo;
  const identifiers = info.industryIdentifiers ?? [];
  const isbn10 = identifiers.find((i) => i.type === "ISBN_10")?.identifier ?? null;
  const isbn13 = identifiers.find((i) => i.type === "ISBN_13")?.identifier ?? null;

  // Google returns http URLs for covers — upgrade to https
  let coverUrl = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null;
  if (coverUrl) {
    coverUrl = coverUrl.replace("http://", "https://");
  }

  const year = info.publishedDate
    ? parseInt(info.publishedDate.substring(0, 4), 10) || null
    : null;

  // Clean title: strip "[Author Name]" prefixes that Google Books sometimes returns
  let title = info.title ?? "Unknown Title";
  title = title.replace(/^\[[^\]]+\]\s*/, "").trim() || title;

  return {
    googleBooksId: vol.id,
    title,
    author: info.authors?.join(", ") ?? "Unknown Author",
    isbn: isbn10,
    isbn13,
    coverUrl,
    pageCount: info.pageCount ?? null,
    publishedYear: year,
    publisher: info.publisher ?? null,
    description: info.description ?? null,
  };
}

export async function searchGoogleBooks(query: string): Promise<BookData[]> {
  const params = new URLSearchParams({
    q: query,
    maxResults: "10",
    printType: "books",
  });

  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  if (apiKey) {
    params.set("key", apiKey);
  }

  const res = await fetch(`${BASE_URL}?${params}`);
  if (!res.ok) return [];

  const data = await res.json();
  const items: GoogleVolume[] = data.items ?? [];

  return items
    .filter((vol) => vol.volumeInfo?.title)
    .map(mapVolume);
}

export async function getGoogleBookById(id: string): Promise<BookData | null> {
  const params = new URLSearchParams();
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  if (apiKey) {
    params.set("key", apiKey);
  }

  const url = params.toString()
    ? `${BASE_URL}/${id}?${params}`
    : `${BASE_URL}/${id}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const vol: GoogleVolume = await res.json();
  if (!vol.volumeInfo?.title) return null;

  return mapVolume(vol);
}
