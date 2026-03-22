export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { getAdminClient } from "@/lib/supabase/admin";
import BookCover from "@/components/ui/BookCover";
import RatingBadge from "@/components/ui/RatingBadge";
import Badge from "@/components/ui/Badge";
import BookRow from "@/components/books/BookRow";
import { hydrateBookDetail } from "@/lib/books/cache";
import { getBookDetail } from "@/lib/books";
import { extractGoodreadsIdFromSlug } from "@/lib/books/goodreads-search";
import { isJunkTitle } from "@/lib/books/romance-filter";
import { deduplicateBooks } from "@/lib/books/utils";
import type { BookDetail } from "@/lib/types";
import { Video } from "lucide-react";
import BookDetailClient from "./BookDetailClient";
import BookPreview from "@/components/books/BookPreview";
import { InlineUserRating } from "./InlineRatings";
import SpiceSection from "./SpiceSection";
import BookTokMentions from "@/components/books/BookTokMentions";
import CreateShareCardButton from "@/components/books/CreateShareCardButton";
import ExpandableText from "@/components/ui/ExpandableText";
import BooktrackSection from "@/components/books/BooktrackSection";

// ── Helpers ──────────────────────────────────────────

/** Strip stray markdown and title/author prefix from AI-generated synopsis text */
function cleanSynopsis(text: string, title: string, author: string): string {
  let cleaned = text
    .replace(/^[#*>\-–—]+\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^[""\u201C]|[""\u201D]$/g, "")
    .replace(/^"|"$/g, "")
    .trim();

  // Strip leading "Title by Author" prefix (with optional punctuation after)
  const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefixPattern = new RegExp(
    `^${escaped(title)}\\s+by\\s+${escaped(author)}[\\s:.,;—–\\-]*`,
    "i"
  );
  cleaned = cleaned.replace(prefixPattern, "").trim();

  return cleaned;
}

// ── Data fetching ────────────────────────────────────

async function getBook(slug: string): Promise<BookDetail | null> {
  // Try the main book service first (handles slug, goodreads_id, ISBN lookups)
  const detail = await getBookDetail(slug);
  if (detail) return detail;

  // Fallback: extract goodreads ID from slug and try direct lookup
  const goodreadsId = extractGoodreadsIdFromSlug(slug);
  if (goodreadsId) {
    return getBookDetail(goodreadsId);
  }

  return null;
}

async function getRelatedBooks(
  book: BookDetail,
  limit: number = 10
): Promise<BookDetail[]> {
  if (book.tropes.length === 0) {
    // No tropes — fall back to same-author books
    const supabase = getAdminClient();
    const { data: authorBooks } = await supabase
      .from("books")
      .select("*")
      .eq("author", book.author)
      .neq("id", book.id)
      .not("cover_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit * 3);

    if (!authorBooks || authorBooks.length === 0) return [];

    const results: BookDetail[] = [];
    for (const b of authorBooks as Record<string, unknown>[]) {
      const title = b.title as string;
      if (isJunkTitle(title)) continue;
      results.push(await hydrateBookDetail(supabase, b));
    }

    // Quality threshold for related books
    const qualified = deduplicateBooks(results)
      .filter((b) => {
        if (!b.coverUrl) return false;
        const grRating = b.ratings.find((r) => r.source === "goodreads");
        return grRating && (grRating.ratingCount ?? 0) >= 500;
      })
      .slice(0, limit);
    return qualified;
  }

  // Find books sharing the most tropes
  const supabase = getAdminClient();
  const tropeIds = book.tropes.map((t) => t.id);

  const { data: sharedTropes } = await supabase
    .from("book_tropes")
    .select("book_id")
    .in("trope_id", tropeIds)
    .neq("book_id", book.id);

  if (!sharedTropes || sharedTropes.length === 0) return [];

  // Count overlapping tropes per book and pick the top ones
  const overlapCount = new Map<string, number>();
  for (const row of sharedTropes) {
    overlapCount.set(row.book_id, (overlapCount.get(row.book_id) ?? 0) + 1);
  }
  const sortedIds = Array.from(overlapCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit * 3) // fetch extra to account for dedup
    .map(([id]) => id);

  if (sortedIds.length === 0) return [];

  const { data: relatedDbBooks } = await supabase
    .from("books")
    .select("*")
    .in("id", sortedIds)
    .not("cover_url", "is", null);

  if (!relatedDbBooks || relatedDbBooks.length === 0) return [];

  const results: BookDetail[] = [];
  for (const b of relatedDbBooks as Record<string, unknown>[]) {
    const title = b.title as string;
    if (isJunkTitle(title)) continue;
    results.push(await hydrateBookDetail(supabase, b));
  }

  // Preserve overlap order
  const orderMap = new Map(sortedIds.map((id, i) => [id, i]));
  results.sort((a, b) => (orderMap.get(a.id) ?? 99) - (orderMap.get(b.id) ?? 99));

  // Quality threshold for related books
  const qualified = deduplicateBooks(results)
    .filter((b) => {
      if (!b.coverUrl) return false;
      const grRating = b.ratings.find((r) => r.source === "goodreads");
      return grRating && (grRating.ratingCount ?? 0) >= 500;
    })
    .slice(0, limit);
  return qualified;
}

// ── SEO metadata ─────────────────────────────────────

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const book = await getBook(params.slug);
  if (!book) {
    return { title: "Book not found — Hotlist" };
  }

  const hasSynopsisForMeta = book.aiSynopsis && book.aiSynopsis.length >= 20;
  const hasDescForMeta = book.description && book.description.length >= 20;
  const metaDescription = hasSynopsisForMeta
    ? book.aiSynopsis!.slice(0, 155) + (book.aiSynopsis!.length > 155 ? "..." : "")
    : hasDescForMeta
      ? book.description!.slice(0, 155) + (book.description!.length > 155 ? "..." : "")
      : `${book.title} by ${book.author} — ratings, spice level, and tropes on Hotlist.`;

  const ogCover =
    book.coverUrl && !book.coverUrl.includes("no-cover") && !book.coverUrl.includes("nophoto")
      ? book.coverUrl
      : null;

  return {
    title: `${book.title} by ${book.author} — Hotlist`,
    description: metaDescription,
    openGraph: {
      title: `${book.title} by ${book.author}`,
      description: metaDescription,
      ...(ogCover && { images: [{ url: ogCover }] }),
    },
  };
}

// ── Page component ───────────────────────────────────

export default async function BookPage({ params }: PageProps) {
  const book = await getBook(params.slug);

  if (!book) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <h1 className="font-display text-3xl font-bold text-ink">
          Book not found
        </h1>
        <p className="mt-3 text-sm font-body text-muted">
          We couldn&apos;t find a book at this URL.
        </p>
        <Link
          href="/"
          className="inline-block mt-6 text-sm font-mono text-fire hover:text-fire/80 transition-colors"
        >
          &larr; Search for another book
        </Link>
      </div>
    );
  }

  const enrichmentStatus = book.enrichmentStatus ?? "pending";
  const relatedBooks = await getRelatedBooks(book);

  // Fetch BookTok creator mentions for this book
  const supabase = getAdminClient();
  const { data: mentionRows } = await supabase
    .from("creator_book_mentions")
    .select("sentiment, quote, platform, creator_handle_id, creator_handles(handle)")
    .eq("book_id", book.id)
    .order("mentioned_at", { ascending: false })
    .limit(10);

  const seenHandles = new Set<string>();
  const creatorMentions = (mentionRows || [])
    .map((row: Record<string, unknown>) => {
      const ch = row.creator_handles as Record<string, unknown> | null;
      return {
        creatorHandle: (ch?.handle as string) || "Unknown",
        platform: (row.platform as string) || "tiktok",
        sentiment: row.sentiment as string | null,
        quote: row.quote as string | null,
      };
    })
    .filter((m) => {
      if (seenHandles.has(m.creatorHandle)) return false;
      seenHandles.add(m.creatorHandle);
      return true;
    });

  // Fetch series books for sidebar navigation
  let seriesBooks: { id: string; title: string; slug: string; seriesPosition: number | null }[] = [];
  if (book.seriesName) {
    const { data: sBooks } = await supabase
      .from("books")
      .select("id, title, slug, series_position")
      .eq("series_name", book.seriesName)
      .order("series_position", { ascending: true, nullsFirst: false })
      .limit(20);

    if (sBooks) {
      seriesBooks = sBooks.map((sb: Record<string, unknown>) => ({
        id: sb.id as string,
        title: sb.title as string,
        slug: sb.slug as string,
        seriesPosition: sb.series_position as number | null,
      }));
    }
  }

  // Detect placeholder covers (Goodreads "no-cover" URLs are useless)
  const isPlaceholderCover =
    !book.coverUrl ||
    book.coverUrl.includes("no-cover") ||
    book.coverUrl.includes("nophoto");
  const coverUrl = isPlaceholderCover ? null : book.coverUrl;

  // Treat very short descriptions as junk (e.g. "1" from bad Goodreads editions)
  const hasDescription = book.description && book.description.length >= 20;
  const hasSynopsis = book.aiSynopsis && book.aiSynopsis.length >= 20;

  // Extract rating data
  const goodreadsRating = book.ratings.find((r) => r.source === "goodreads");
  const amazonRating = book.ratings.find((r) => r.source === "amazon");
  const romanceIoRating = book.ratings.find((r) => r.source === "romance_io");

  // Extract spice data
  const romanceIoSpice = book.spice.find(
    (s) => s.source === "romance_io" && s.confidence === "high"
  );
  const communitySpice = book.spice.find((s) => s.source === "hotlist_community");
  const inferredSpice = book.spice.find((s) => s.source === "goodreads_inference");

  // Affiliate links
  const amazonTag = process.env.AMAZON_AFFILIATE_TAG;
  const bnTag = process.env.BARNES_NOBLE_AFFILIATE_TAG;
  const bookshopTag = process.env.BOOKSHOP_AFFILIATE_TAG;
  const searchTerms = encodeURIComponent(book.title + " " + book.author);

  const amazonSearchUrl = amazonTag
    ? `https://www.amazon.com/s?k=${searchTerms}&tag=${amazonTag}`
    : `https://www.amazon.com/s?k=${searchTerms}`;
  const amazonDirectUrl = book.amazonAsin
    ? `https://www.amazon.com/dp/${book.amazonAsin}${amazonTag ? `?tag=${amazonTag}` : ""}`
    : null;
  const kindleUrl = amazonDirectUrl ?? (amazonSearchUrl + "&i=digital-text");
  const bnUrl = book.isbn13
    ? `https://www.barnesandnoble.com/w/?ean=${book.isbn13}`
    : `https://www.barnesandnoble.com/s/${searchTerms}?store=EBOOK${bnTag ? `&utm_source=${bnTag}` : ""}`;
  const bookshopUrl = book.isbn13
    ? `https://bookshop.org/p/books/-/${book.isbn13}${bookshopTag ? `?a_aid=${bookshopTag}` : ""}`
    : bookshopTag
      ? `https://bookshop.org/a/${bookshopTag}/books/search?keywords=${searchTerms}`
      : `https://bookshop.org/books/search?keywords=${searchTerms}`;

  // Romance.io URL with fallback for slugs without full path
  const romanceIoUrl = book.romanceIoSlug?.includes("/")
    ? `https://www.romance.io/books/${book.romanceIoSlug}`
    : `https://www.google.com/search?q=${encodeURIComponent(`site:romance.io "${book.title}" "${book.author}"`)}`;

  // JSON-LD structured data
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Book",
    name: book.title,
    author: { "@type": "Person", name: book.author },
    ...(book.isbn13 && { isbn: book.isbn13 }),
    ...(book.pageCount && { numberOfPages: book.pageCount }),
    ...(book.publishedYear && {
      datePublished: String(book.publishedYear),
    }),
    ...(coverUrl && { image: coverUrl }),
    ...(hasDescription && { description: book.description!.slice(0, 500) }),
    ...(goodreadsRating?.rating && {
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: goodreadsRating.rating,
        ratingCount: goodreadsRating.ratingCount ?? 0,
        bestRating: 5,
      },
    }),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-10 pb-24 sm:pb-10">

        {/* ── Zone A: Hero Header ── */}
        <div className="flex flex-col sm:flex-row gap-5 sm:gap-8 pb-6 sm:pb-8 border-b border-border">

          {/* Cover — fixed width on desktop, centered on mobile */}
          <div className="flex justify-center sm:justify-start shrink-0">
            <BookCover
              title={book.title}
              coverUrl={coverUrl}
              size="fill"
              className="w-[140px] h-[210px] sm:w-[200px] sm:h-[300px] object-contain rounded-lg shadow-lg shadow-ink/10"
            />
          </div>

          {/* Identity + Ratings + Actions */}
          <div className="flex-1 min-w-0 flex flex-col">

            {/* Title + Author + Series */}
            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink leading-tight">
                {book.title}
              </h1>
              <p className="mt-1 text-sm font-body">
                <span className="text-muted">by </span>
                <Link
                  href={`/search?q=${encodeURIComponent(book.author)}`}
                  className="text-fire hover:text-fire/80 transition-colors"
                >
                  {book.author}
                </Link>
                {book.seriesName && (
                  <span className="text-muted">
                    {" \u00B7 "}
                    {book.seriesPosition
                      ? `${book.seriesName} #${book.seriesPosition}`
                      : book.seriesName}
                  </span>
                )}
              </p>
              {/* Compact metadata line */}
              <p className="mt-1 text-xs font-mono text-muted/70">
                {[
                  book.publishedYear,
                  book.pageCount ? `${book.pageCount} pages` : null,
                  book.publisher,
                ]
                  .filter(Boolean)
                  .join(" \u00B7 ")}
              </p>
            </div>

            {/* Trope pills */}
            {book.tropes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {book.tropes.map((trope) => (
                  <Link key={trope.id} href={`/tropes/${trope.slug}`}>
                    <Badge variant="trope" className="cursor-pointer">
                      {trope.name}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}

            {/* Ratings row — ALL sources inline with user rating */}
            <div data-rating-row className="flex flex-wrap items-start gap-4 sm:gap-6 mt-4 pb-4 border-b border-border">
              {book.goodreadsId ? (
                <a
                  href={`https://www.goodreads.com/book/show/${book.goodreadsId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group"
                >
                  <RatingBadge
                    score={goodreadsRating?.rating ?? null}
                    source="goodreads"
                    ratingCount={goodreadsRating?.ratingCount}
                    external
                  />
                </a>
              ) : (
                <RatingBadge
                  score={goodreadsRating?.rating ?? null}
                  source="goodreads"
                  ratingCount={goodreadsRating?.ratingCount}
                />
              )}
              {amazonRating?.rating != null && (
                <a
                  href={book.amazonAsin
                    ? `https://www.amazon.com/dp/${book.amazonAsin}${amazonTag ? `?tag=${amazonTag}` : ""}`
                    : `https://www.amazon.com/s?k=${searchTerms}${amazonTag ? `&tag=${amazonTag}` : ""}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group"
                >
                  <RatingBadge
                    score={amazonRating.rating}
                    source="amazon"
                    ratingCount={amazonRating.ratingCount}
                    external
                  />
                </a>
              )}
              {(romanceIoRating?.rating != null || romanceIoSpice) && (
                <a
                  href={romanceIoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group"
                >
                  <RatingBadge
                    score={romanceIoRating?.rating ?? null}
                    source="romance_io"
                    ratingCount={romanceIoRating?.ratingCount}
                    external
                  />
                </a>
              )}
              {/* Inline user star rating */}
              <div className="border-l border-border pl-4 sm:pl-6">
                <InlineUserRating bookId={book.id} />
              </div>
            </div>

            {/* Action row — pushed to bottom of the hero via flex-grow spacer */}
            <div className="mt-auto pt-4 flex flex-wrap items-center gap-2">
              {/* Add to Hotlist — primary CTA */}
              <BookDetailClient
                section="add-to-hotlist"
                bookId={book.id}
                bookTitle={book.title}
              />

              {/* Kindle — secondary CTA */}
              <a
                href={kindleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink text-white font-body font-medium text-sm px-4 min-h-[40px] hover:bg-ink/90 transition-colors"
              >
                Read on Kindle &rarr;
              </a>

              {/* Print buy options — compact row */}
              <div className="flex gap-1.5">
                <a
                  href={amazonDirectUrl ?? amazonSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-lg bg-white text-ink border border-border font-body text-xs px-3 min-h-[36px] hover:bg-cream transition-colors"
                >
                  Amazon
                </a>
                <a
                  href={bnUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-lg bg-white text-ink border border-border font-body text-xs px-3 min-h-[36px] hover:bg-cream transition-colors"
                >
                  B&amp;N
                </a>
                <a
                  href={bookshopUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-lg bg-white text-ink border border-border font-body text-xs px-3 min-h-[36px] hover:bg-cream transition-colors"
                >
                  Bookshop
                </a>
              </div>

              {/* Reading status — right-aligned on desktop */}
              <div className="sm:ml-auto">
                <BookDetailClient
                  section="reading-status"
                  bookId={book.id}
                  bookTitle={book.title}
                />
              </div>
            </div>

            {/* Creator share card button */}
            <CreateShareCardButton bookSlug={book.slug} />

            {/* Enrichment poller */}
            {enrichmentStatus !== "complete" && (
              <BookDetailClient
                section="enrichment-poller"
                bookId={book.id}
                bookTitle={book.title}
                bookAuthor={book.author}
                enrichmentStatus={enrichmentStatus}
              />
            )}
          </div>
        </div>

        {/* ── Zone B: Content Body ── */}
        <div className="mt-6 sm:mt-8 grid grid-cols-1 sm:grid-cols-[1fr_280px] gap-6 sm:gap-8">

          {/* ── Main column ── */}
          <div className="min-w-0">

            {/* Synopsis */}
            <div className="pb-6 border-b border-border">
              <h2 className="text-xs font-mono text-muted uppercase tracking-wide mb-2">
                About this book
              </h2>
              {hasSynopsis ? (
                <div>
                  <ExpandableText
                    text={cleanSynopsis(book.aiSynopsis!, book.title, book.author)}
                    maxLines={3}
                    className="font-body text-ink/90 leading-[1.85]"
                    style={{ fontSize: "0.95rem" }}
                  />
                  <span className="inline-block mt-2 text-xs font-mono text-muted/70">
                    AI-generated synopsis
                  </span>
                </div>
              ) : hasDescription ? (
                <div>
                  <p className="font-body text-ink/80 text-sm leading-relaxed">
                    {book.description}
                  </p>
                  {book.goodreadsId && (
                    <a
                      href={`https://www.goodreads.com/book/show/${book.goodreadsId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-2 text-xs font-mono text-muted/60 hover:text-fire transition-colors"
                    >
                      Description from Goodreads {"\u2197"}
                    </a>
                  )}
                </div>
              ) : (
                <p className="font-body text-muted/70 text-sm italic">
                  No synopsis available yet.
                </p>
              )}
            </div>

            {/* Spice detail — full SpiceSection */}
            <div className="py-6 border-b border-border">
              <SpiceSection
                bookId={book.id}
                compositeSpice={book.compositeSpice}
                romanceIoSpice={romanceIoSpice ? {
                  spiceLevel: romanceIoSpice.spiceLevel,
                  source: "romance_io",
                  ratingCount: romanceIoSpice.ratingCount,
                  confidence: romanceIoSpice.confidence ?? null,
                } : null}
                romanceIoHeatLabel={book.romanceIoHeatLabel}
                romanceIoSlug={book.romanceIoSlug}
                communitySpice={communitySpice ? {
                  spiceLevel: communitySpice.spiceLevel,
                  source: "hotlist_community",
                  ratingCount: communitySpice.ratingCount,
                  confidence: null,
                } : null}
                inferredSpice={inferredSpice ? {
                  spiceLevel: inferredSpice.spiceLevel,
                  source: "goodreads_inference",
                  ratingCount: inferredSpice.ratingCount,
                  confidence: inferredSpice.confidence ?? null,
                } : null}
              />
            </div>

            {/* Seen on BookTok */}
            <div className="py-6">
              <BookTokMentions mentions={creatorMentions} />
            </div>

            {/* Google Books preview */}
            <BookPreview
              isbn={book.isbn13 ?? book.isbn ?? null}
              googleBooksId={book.googleBooksId ?? null}
              title={book.title}
            />
          </div>

          {/* ── Sidebar (280px on desktop, full-width stacked on mobile) ── */}
          <div className="space-y-6">

            {/* Booktrack — Spotify playlists + AI reading vibes prompt */}
            <BooktrackSection
              spotifyPlaylists={book.spotifyPlaylists}
              booktrackPrompt={book.booktrackPrompt}
              booktrackMoods={book.booktrackMoods}
              bookTitle={book.title}
            />

            {/* Series navigation */}
            {book.seriesName && seriesBooks.length > 1 && (
              <div>
                <h3 className="text-xs font-mono text-muted uppercase tracking-wide mb-2">
                  {book.seriesName}
                </h3>
                <div className="flex flex-col gap-1.5">
                  {seriesBooks.map((sb) => {
                    const isCurrent = sb.id === book.id;
                    return (
                      <Link
                        key={sb.id}
                        href={`/book/${sb.slug}`}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                          isCurrent
                            ? "bg-fire/5 border border-fire/20 text-ink font-medium"
                            : "border border-border hover:border-muted/40 text-ink/80"
                        }`}
                      >
                        <span className={`text-xs font-mono ${isCurrent ? "text-fire" : "text-muted"}`}>
                          {sb.seriesPosition ?? "?"}
                        </span>
                        <span className="truncate">{sb.title}</span>
                        {isCurrent && (
                          <span className="ml-auto text-[10px] font-mono text-fire/60">
                            current
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Source links */}
            <div>
              <h3 className="text-xs font-mono text-muted uppercase tracking-wide mb-2">
                View on
              </h3>
              <div className="flex flex-col gap-1">
                {book.goodreadsId && (
                  <a
                    href={`https://www.goodreads.com/book/show/${book.goodreadsId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-body text-muted/70 hover:text-fire transition-colors"
                  >
                    See reviews on Goodreads <span className="opacity-50">{"\u2197"}</span>
                  </a>
                )}
                {book.romanceIoSlug && (
                  <a
                    href={romanceIoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-body text-muted/70 hover:text-fire transition-colors"
                  >
                    View on Romance.io <span className="opacity-50">{"\u2197"}</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Zone C: Full-width bottom ── */}

        {/* Readers also loved */}
        <section className="mt-8 sm:mt-12 pt-6 sm:pt-8 border-t border-border">
          <h2 className="font-display text-xl sm:text-2xl font-bold text-ink mb-4">
            Readers also loved
          </h2>
          {relatedBooks.length > 0 ? (
            <BookRow books={relatedBooks} />
          ) : (
            <p className="text-sm font-body text-muted/70 py-4">
              We&apos;re still finding similar books. Check back soon!
            </p>
          )}
        </section>

        {/* BookTok CTA */}
        <section className="mt-8 pt-6 border-t border-border">
          <div className="flex items-center gap-3">
            <Video size={20} className="text-fire" aria-hidden="true" />
            <div>
              {creatorMentions.length > 0 ? (
                <>
                  <p className="text-sm font-body text-ink font-medium">
                    Recommended by @{creatorMentions[0].creatorHandle}
                  </p>
                  <Link
                    href={`/discover/${encodeURIComponent(creatorMentions[0].creatorHandle)}`}
                    className="text-xs font-mono text-fire hover:text-fire/80 transition-colors"
                  >
                    See all their picks &rarr;
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-sm font-body text-ink font-medium">
                    Saw this on BookTok?
                  </p>
                  <Link
                    href="/booktok"
                    className="text-xs font-mono text-fire hover:text-fire/80 transition-colors"
                  >
                    Paste that video link and find every book &rarr;
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* ── Sticky mobile CTA ── */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-sm border-t border-border px-4 py-3">
        <BookDetailClient
          section="mobile-cta"
          bookId={book.id}
          bookTitle={book.title}
        />
      </div>
    </>
  );
}
