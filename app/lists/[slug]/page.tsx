export const dynamic = "force-dynamic";

import { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getHotlistWithBooks } from "@/lib/hotlists";
import HotlistDetailClient from "./HotlistDetailClient";

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const hotlist = await getHotlistWithBooks(params.slug);

  if (!hotlist) {
    return { title: "Hotlist Not Found" };
  }

  return {
    title: `${hotlist.name} — Hotlist`,
    description: `Check out ${hotlist.ownerName ?? "a reader"}'s Hotlist: ${hotlist.name} — ${hotlist.books.length} books compared`,
    openGraph: {
      title: `${hotlist.name} — Hotlist`,
      description: `${hotlist.ownerName ?? "A reader"}'s Hotlist with ${hotlist.books.length} books compared side by side`,
      type: "website",
    },
  };
}

export default async function HotlistDetailPage({ params }: Props) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const hotlist = await getHotlistWithBooks(params.slug, user?.id);

  // Private list viewed by non-owner
  if (!hotlist) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-ink mb-3">
          This Hotlist is private
        </h1>
        <p className="text-sm font-body text-muted mb-6">
          The owner hasn&apos;t shared this list publicly.
        </p>
        <a
          href="/"
          className="inline-block px-5 py-2.5 bg-fire text-white text-sm font-mono rounded-lg hover:bg-fire/90 transition-colors"
        >
          Browse books
        </a>
      </div>
    );
  }

  const isOwner = user?.id === hotlist.userId;

  return (
    <HotlistDetailClient
      hotlist={hotlist}
      isOwner={isOwner}
      currentUserId={user?.id ?? null}
    />
  );
}
