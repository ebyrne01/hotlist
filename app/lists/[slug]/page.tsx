export const dynamic = "force-dynamic";

import { cache } from "react";
import { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getHotlistWithBooks, getHotlistMetadata } from "@/lib/hotlists";
import HotlistDetailClient from "./HotlistDetailClient";

interface Props {
  params: { slug: string };
}

// React cache() deduplicates within a single server request
const getCachedHotlist = cache((slug: string, userId?: string) =>
  getHotlistWithBooks(slug, userId)
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // Lightweight query — just hotlist name + creator handle + book count
  const meta = await getHotlistMetadata(params.slug);

  if (!meta) {
    return { title: "Hotlist Not Found" };
  }

  const byline = meta.sourceCreatorHandle
    ? `${meta.sourceCreatorHandle}'s`
    : meta.ownerName
      ? `${meta.ownerName}'s`
      : "a reader's";

  return {
    title: `${meta.name} — Hotlist`,
    description: `Check out ${byline} Hotlist: ${meta.name} — ${meta.bookCount} books compared`,
    openGraph: {
      title: `${meta.name} — Hotlist`,
      description: `${byline} Hotlist with ${meta.bookCount} books compared side by side`,
      type: "website",
    },
  };
}

export default async function HotlistDetailPage({ params }: Props) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const hotlist = await getCachedHotlist(params.slug, user?.id);

  // Hotlist not found (deleted or never existed)
  if (!hotlist) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-ink mb-3">
          Hotlist not found
        </h1>
        <p className="text-sm font-body text-muted mb-6">
          This Hotlist may have been deleted or the link may be incorrect.
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

  // Private list viewed by non-owner
  if ("_accessDenied" in hotlist) {
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
