/**
 * /card/[cardId]
 *
 * Public share page for a creator's book card.
 * Renders card data as responsive HTML with CTAs and affiliate buy links.
 * OG metadata uses the card image for rich link previews.
 */

import { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import { fetchShareCardData } from "@/lib/share-card/fetch-card-data";
import { getAdminClient } from "@/lib/supabase/admin";
import ShareCardActions from "./ShareCardActions";

interface PageProps {
  params: { cardId: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const data = await fetchShareCardData(params.cardId);
  if (!data) return { title: "Card not found" };

  const handle = data.creator.vanitySlug
    ? `@${data.creator.vanitySlug}`
    : data.creator.displayName ?? "a creator";

  const peppers = "🌶️".repeat(data.spiceLevel);

  const description = data.card.creatorQuote
    ? `"${data.card.creatorQuote}" — ${data.book.title} by ${data.book.author}. Spice: ${peppers}. On Hotlist.`
    : `${data.book.title} by ${data.book.author}.${data.ratings.goodreads ? ` Rated ${data.ratings.goodreads.toFixed(1)} on Goodreads.` : ""}${peppers ? ` Spice: ${peppers}.` : ""}`;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://myhotlist.app";

  return {
    title: `${data.book.title} — recommended by ${handle}`,
    description,
    openGraph: {
      title: `${data.book.title} — recommended by ${handle}`,
      description,
      images: [
        {
          url: `${appUrl}/api/creator/share-card/${params.cardId}/image`,
          width: 1080,
          height: 1920,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
    },
  };
}

const HEAT_LABELS: Record<number, string> = {
  1: "Sweet",
  2: "Mild",
  3: "Steamy",
  4: "Spicy",
  5: "Scorching",
};

export default async function ShareCardPage({ params }: PageProps) {
  const data = await fetchShareCardData(params.cardId);
  if (!data) notFound();

  // Increment view count (fire-and-forget)
  const admin = getAdminClient();
  admin
    .from("creator_share_cards")
    .update({ view_count: data.card.viewCount + 1 })
    .eq("id", data.card.id)
    .then(() => {});

  const handle = data.creator.vanitySlug
    ? `@${data.creator.vanitySlug}`
    : data.creator.displayName ?? "";

  const affiliateTag =
    data.creator.amazonAffiliateTag ??
    process.env.NEXT_PUBLIC_AMAZON_AFFILIATE_TAG ??
    "";

  return (
    <div className="min-h-screen bg-[#1A0F0A]">
      <div className="max-w-[480px] mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 16 16">
              <path
                d="M8 1c1.5 2.5 4 4 4 7.5a4 4 0 0 1-8 0C4 5 6.5 3.5 8 1z"
                fill="#D85A30"
              />
            </svg>
            <span className="text-lg italic text-[#E8D5C4]" style={{ fontFamily: "serif" }}>
              Hotlist
            </span>
          </div>
          <span className="text-sm text-[#A08B78]">{handle}</span>
        </div>

        {/* Book cover */}
        <div className="flex justify-center mb-6">
          {data.book.coverUrl ? (
            <Image
              src={data.book.coverUrl}
              alt={data.book.title}
              width={200}
              height={300}
              className="rounded-2xl shadow-2xl object-cover"
            />
          ) : (
            <div className="w-[200px] h-[300px] rounded-2xl bg-[#3A2A1E] flex items-center justify-center">
              <span className="text-[#6B5A45] italic text-center px-4" style={{ fontFamily: "serif" }}>
                {data.book.title}
              </span>
            </div>
          )}
        </div>

        {/* Title + Author */}
        <h1
          className="text-2xl font-medium text-[#FAF0E6] text-center mb-1"
          style={{ fontFamily: "serif" }}
        >
          {data.book.title}
        </h1>
        <p className="text-center text-[#A08B78] mb-6">{data.book.author}</p>

        {/* Spice */}
        {data.spiceLevel > 0 && (
          <div className="flex flex-col items-center mb-6">
            <div className="flex items-center gap-0.5 mb-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <span
                  key={n}
                  className={`select-none ${n <= data.spiceLevel ? "opacity-100" : "opacity-20 grayscale"}`}
                  style={{ fontSize: 24, lineHeight: 1 }}
                >
                  🌶️
                </span>
              ))}
            </div>
            <span className="text-sm text-[#C88A5A]">
              {HEAT_LABELS[data.spiceLevel] ?? ""}
            </span>
          </div>
        )}

        {/* Tropes */}
        {data.tropes.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 mb-6">
            {data.tropes.slice(0, 4).map((trope) => (
              <span
                key={trope}
                className="text-xs text-[#C8A882] px-3 py-1.5 rounded-full border border-[#3A2A1E]"
                style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
              >
                {trope}
              </span>
            ))}
          </div>
        )}

        {/* Divider */}
        <div className="h-px bg-white/5 mb-6" />

        {/* Ratings */}
        {(data.ratings.goodreads || data.ratings.amazon) && (
          <div className="flex justify-center gap-12 mb-6">
            {data.ratings.goodreads && (
              <div className="text-center">
                <div className="text-2xl font-medium text-[#FAF0E6]">
                  {data.ratings.goodreads.toFixed(1)}
                </div>
                <div className="text-xs text-[#6B5A45]">Goodreads</div>
              </div>
            )}
            {data.ratings.amazon && (
              <div className="text-center">
                <div className="text-2xl font-medium text-[#FAF0E6]">
                  {data.ratings.amazon.toFixed(1)}
                </div>
                <div className="text-xs text-[#6B5A45]">Amazon</div>
              </div>
            )}
          </div>
        )}

        {/* Creator quote */}
        {data.card.creatorQuote && (
          <>
            <div className="h-px bg-white/5 mb-6" />
            <p
              className="text-center italic text-[#C8A882] mb-6 leading-relaxed"
              style={{ fontFamily: "serif" }}
            >
              &ldquo;{data.card.creatorQuote}&rdquo;
            </p>
          </>
        )}

        {/* Divider */}
        <div className="h-px bg-white/5 mb-6" />

        {/* CTAs */}
        <div className="space-y-3">
          <a
            href={`/book/${data.book.slug}`}
            className="block w-full text-center px-4 py-3 rounded-lg bg-[#D85A30] text-[#FAF0E6] text-sm font-medium hover:bg-[#D85A30]/90 transition-colors"
          >
            View full details on Hotlist &rarr;
          </a>
          {data.creator.vanitySlug && (
            <a
              href={`/${data.creator.vanitySlug}`}
              className="block w-full text-center px-4 py-3 rounded-lg border border-[#3A2A1E] text-[#C8A882] text-sm hover:bg-white/5 transition-colors"
            >
              See more from {handle} &rarr;
            </a>
          )}
        </div>

        {/* Share actions (copy URL) */}
        <ShareCardActions cardId={params.cardId} />

        {/* Buy links */}
        {affiliateTag && (
          <div className="mt-6">
            <p className="text-xs text-[#6B5A45] text-center mb-3">Buy this book</p>
            <div className="flex justify-center gap-3">
              <a
                href={`https://www.amazon.com/s?k=${encodeURIComponent(data.book.title + " " + data.book.author)}&tag=${affiliateTag}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg border border-[#3A2A1E] text-xs text-[#A08B78] hover:bg-white/5 transition-colors"
              >
                Amazon
              </a>
              <a
                href={`https://bookshop.org/search?keywords=${encodeURIComponent(data.book.title + " " + data.book.author)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg border border-[#3A2A1E] text-xs text-[#A08B78] hover:bg-white/5 transition-colors"
              >
                Bookshop.org
              </a>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-10 text-center">
          <a
            href="/"
            className="text-xs text-[#4A3828] hover:text-[#6B5A45] transition-colors"
            style={{ fontFamily: "monospace" }}
          >
            myhotlist.app
          </a>
        </div>
      </div>
    </div>
  );
}
