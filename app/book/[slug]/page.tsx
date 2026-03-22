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

      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-10">
        {/* ── Zone A: Decision block (above fold) ── */}
        <div className="grid grid-cols-[100px_1fr] sm:grid-cols-[240px_1fr] gap-4 sm:gap-8 items-start">
          {/* Cover */}
          <BookCover
            title={book.title}
            coverUrl={coverUrl}
            size="fill"
            className="w-full aspect-[2/3] object-contain rounded-lg shadow-md"
          />

          {/* Decision info */}
          <div className="min-w-0">
            <h1 className="font-display text-xl sm:text-4xl font-bold text-ink leading-tight">
              {book.title}
            </h1>
            <p className="mt-1 text-sm font-body text-muted">
              by{" "}
              <Link
                href={`/search?q=${encodeURIComponent(book.author)}`}
                className="text-ink hover:text-fire transition-colors"
              >
                {book.author}
              </Link>
              {" "}
              <Link
                href={`/search?q=${encodeURIComponent(book.author)}`}
                className="text-xs font-mono text-fire/70 hover:text-fire transition-colors"
              >
                See all &rarr;
              </Link>
            </p>
            {book.seriesName && (
              <p className="mt-0.5 text-sm font-body text-muted italic">
                <Link
                  href={`/search?q=${encodeURIComponent(book.seriesName)}`}
                  className="hover:text-fire transition-colors"
                >
                  {book.seriesName}
                </Link>
                {book.seriesPosition ? ` #${book.seriesPosition}` : ""}
              </p>
            )}

            {/* Trope tags */}
            <div className="mt-3">
              {book.tropes.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {book.tropes.map((trope) => (
                    <Link key={trope.id} href={`/tropes/${trope.slug}`}>
                      <Badge variant="trope" className="cursor-pointer">
                        {trope.name}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-body text-muted/70">
                  No tropes tagged yet.{" "}
                  <Link
                    href="/tropes"
                    className="text-fire/70 hover:text-fire transition-colors font-mono text-xs"
                  >
                    Suggest a trope &rarr;
                  </Link>
                </p>
              )}
            </div>

            {/* Ratings row */}
            <div data-rating-row className="flex flex-wrap items-start gap-4 sm:gap-6 mt-4">
              <RatingBadge
                score={goodreadsRating?.rating ?? null}
                source="goodreads"
                ratingCount={goodreadsRating?.ratingCount}
              />
              {amazonRating?.rating != null && (
                <RatingBadge
                  score={amazonRating.rating}
                  source="amazon"
                  ratingCount={amazonRating.ratingCount}
                />
              )}
              {(romanceIoRating?.rating != null || romanceIoSpice) && (
                <a
                  href={book.romanceIoSlug
                    ? `https://romance.io/books/${book.romanceIoSlug}`
                    : `https://romance.io/search?q=${encodeURIComponent(book.title + " " + book.author)}`}
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
            </div>

            {/* Add to Hotlist — desktop only */}
            <div className="hidden sm:block mt-4">
              <BookDetailClient
                section="add-to-hotlist"
                bookId={book.id}
                bookTitle={book.title}
              />
            </div>
          </div>
        </div>

        {/* ── Zone B: Reference + Discovery (below fold) ── */}
        <div className="mt-8 sm:mt-12 grid grid-cols-1 sm:grid-cols-[240px_1fr] gap-8">
          {/* Sidebar: spice + metadata + buy links + reading status */}
          <div className="order-2 sm:order-1 flex flex-col gap-4">
            {/* Your rating — star rating adjacent to spice */}
            <InlineUserRating bookId={book.id} />

            {/* Spice level */}
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

            {/* Metadata list */}
            <dl className="w-full text-sm font-body space-y-1.5">
              {book.seriesName && (
                <div className="flex justify-between">
                  <dt className="text-muted font-mono text-xs">Series</dt>
                  <dd className="text-ink text-right">
                    <Link
                      href={`/search?q=${encodeURIComponent(book.seriesName)}`}
                      className="hover:text-fire transition-colors"
                    >
                      {book.seriesPosition
                        ? `Book ${book.seriesPosition} of ${book.seriesName}`
                        : book.seriesName}
                    </Link>
                  </dd>
                </div>
              )}
              {book.publishedYear && (
                <div className="flex justify-between">
                  <dt className="text-muted font-mono text-xs">Published</dt>
                  <dd className="text-ink">{book.publishedYear}</dd>
                </div>
              )}
              {book.pageCount && (
                <div className="flex justify-between">
                  <dt className="text-muted font-mono text-xs">Pages</dt>
                  <dd className="text-ink">{book.pageCount}</dd>
                </div>
              )}
              {book.publisher && (
                <div className="flex justify-between">
                  <dt className="text-muted font-mono text-xs">Publisher</dt>
                  <dd className="text-ink text-right truncate max-w-[180px]">
                    {book.publisher}
                  </dd>
                </div>
              )}
            </dl>

            {/* Buy buttons */}
            <div className="w-full flex flex-col gap-2">
              <a
                href={kindleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-fire text-white font-body font-medium text-sm px-4 min-h-[44px] hover:bg-fire/90 transition-colors"
              >
                Read on Kindle &rarr;
              </a>
              <p className="text-xs font-mono text-muted/70 uppercase tracking-wide mt-1">
                Buy Print
              </p>
              <div className="flex gap-2">
                <a
                  href={amazonDirectUrl ?? amazonSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center rounded-lg bg-white text-ink border border-border font-body text-xs px-2 min-h-[38px] hover:bg-cream transition-colors"
                >
                  Amazon
                </a>
                <a
                  href={bnUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center rounded-lg bg-white text-ink border border-border font-body text-xs px-2 min-h-[38px] hover:bg-cream transition-colors"
                >
                  B&amp;N
                </a>
                <a
                  href={bookshopUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center rounded-lg bg-white text-ink border border-border font-body text-xs px-2 min-h-[38px] hover:bg-cream transition-colors"
                >
                  Bookshop
                </a>
              </div>
            </div>

            {/* Google Books preview */}
            <BookPreview
              isbn={book.isbn13 ?? book.isbn ?? null}
              googleBooksId={book.googleBooksId ?? null}
              title={book.title}
            />

            {/* Reading status */}
            <BookDetailClient
              section="reading-status"
              bookId={book.id}
              bookTitle={book.title}
            />

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

          {/* Main content: synopsis */}
          <div className="order-1 sm:order-2 min-w-0">
            {/* AI Synopsis */}
            <div>
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
                <p className="font-body text-ink/80 text-sm leading-relaxed">
                  {book.description}
                </p>
              ) : (
                <p className="font-body text-muted/70 text-sm italic">
                  No synopsis available yet.
                </p>
              )}
            </div>

            {/* Creator share card button (only visible to verified creators) */}
            <div className="mt-3">
              <CreateShareCardButton bookSlug={book.slug} />
            </div>
          </div>
        </div>

        {/* ── Seen on BookTok ── */}
        <BookTokMentions mentions={creatorMentions} />

        {/* ── Readers also loved ── */}
        <section className="mt-12 pt-8 border-t border-border">
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

        {/* ── BookTok CTA ── */}
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
