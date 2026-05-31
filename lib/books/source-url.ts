export type BookSourceProvider =
  | "goodreads"
  | "amazon"
  | "romance_io"
  | "hotlist"
  | "google_books"
  | "open_library"
  | "storygraph"
  | "external_url";

export interface BookSourceIds {
  goodreads_id?: string;
  asin?: string;
  romance_io_slug?: string;
}

export function providerFromUrl(url: URL): BookSourceProvider {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host.includes("goodreads.com")) return "goodreads";
  if (host.includes("amazon.")) return "amazon";
  if (host.includes("romance.io")) return "romance_io";
  if (host.includes("myhotlist.app") || host.includes("hotlist.app")) {
    return "hotlist";
  }
  if (host.includes("books.google.")) return "google_books";
  if (host.includes("openlibrary.org")) return "open_library";
  if (host.includes("storygraph.com")) return "storygraph";
  return "external_url";
}

export function titleHintFromUrl(url: URL): string | null {
  const pathParts = url.pathname
    .split("/")
    .map((part) => decodeURIComponent(part))
    .filter(Boolean);

  if (pathParts.length === 0) return null;

  const lastPart = pathParts[pathParts.length - 1]
    .replace(/^\d+[-_.]?/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (lastPart.length < 3 || /^[A-Z0-9]{10}$/i.test(lastPart)) return null;
  return lastPart.slice(0, 180);
}

export function externalIdsFromUrl(url: URL): BookSourceIds {
  const provider = providerFromUrl(url);
  const ids: BookSourceIds = {};
  const path = url.pathname;

  if (provider === "goodreads") {
    const match = path.match(/\/book\/show\/(\d+)/);
    if (match?.[1]) ids.goodreads_id = match[1];
  }

  if (provider === "amazon") {
    const match = path.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (match?.[1]) ids.asin = match[1].toUpperCase();
  }

  if (provider === "romance_io") {
    const slug = path
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.trim();
    if (slug) ids.romance_io_slug = slug;
  }

  return ids;
}
