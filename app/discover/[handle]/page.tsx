/**
 * Auto-generated creator discovery page.
 * Shows all books recommended by a creator across their grabbed videos.
 * Route: /discover/@bookbub (or /discover/bookbub)
 */

import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAdminClient } from "@/lib/supabase/admin";
import { hydrateBookDetail } from "@/lib/books/cache";
import CreatorDiscoveryClient from "./CreatorDiscoveryClient";
import type { BookDetail } from "@/lib/types";

interface PageProps {
  params: { handle: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const handle = decodeURIComponent(params.handle);
  const displayHandle = handle.startsWith("@") ? handle : `@${handle}`;

  return {
    title: `${displayHandle} Book Recommendations — Hotlist`,
    description: `See every book recommended by ${displayHandle} on BookTok, with ratings, spice levels, and tropes.`,
  };
}

export default async function CreatorDiscoveryPage({ params }: PageProps) {
  const supabase = getAdminClient();
  const rawHandle = decodeURIComponent(params.handle);

  // Try with @ prefix first, then without
  const handles = rawHandle.startsWith("@") ? [rawHandle, rawHandle.slice(1)] : [`@${rawHandle}`, rawHandle];

  let creator: Record<string, unknown> | null = null;
  for (const h of handles) {
    const { data } = await supabase
      .from("creator_handles")
      .select("*")
      .eq("handle", h)
      .single();
    if (data) {
      creator = data;
      break;
    }
  }

  if (!creator) notFound();

  // Fetch all book mentions for this creator
  const { data: mentions } = await supabase
    .from("creator_book_mentions")
    .select("book_id, sentiment, quote, video_url, platform, mentioned_at")
    .eq("creator_handle_id", creator.id as string)
    .order("mentioned_at", { ascending: false });

  if (!mentions || mentions.length === 0) {
    return (
      <CreatorDiscoveryClient
        creator={creator}
        books={[]}
      />
    );
  }

  // Deduplicate by book_id (keep most recent)
  const uniqueBookIds = Array.from(new Set(mentions.map((m: Record<string, unknown>) => m.book_id as string)));

  // Hydrate books
  const { data: bookRows } = await supabase
    .from("books")
    .select("*")
    .in("id", uniqueBookIds);

  const hydratedBooks: BookDetail[] = await Promise.all(
    (bookRows || []).map((row: Record<string, unknown>) => hydrateBookDetail(supabase, row))
  );

  // Attach mention metadata to each book
  const booksWithMentions = hydratedBooks.map((book) => {
    const mention = mentions.find((m: Record<string, unknown>) => m.book_id === book.id);
    return {
      ...book,
      creatorSentiment: (mention?.sentiment as string) || null,
      creatorQuote: (mention?.quote as string) || null,
    };
  });

  return (
    <CreatorDiscoveryClient
      creator={creator}
      books={booksWithMentions}
    />
  );
}
