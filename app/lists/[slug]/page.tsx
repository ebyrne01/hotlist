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

  if (!hotlist || "_accessDenied" in hotlist) {
    return { title: "Hotlist Not Found" };
  }

  const byline = hotlist.sourceCreatorHandle
    ? `${hotlist.sourceCreatorHandle}'s`
    : hotlist.ownerName
      ? `${hotlist.ownerName}'s`
      : "a reader's";

  return {
    title: `${hotlist.name} — Hotlist`,
    description: `Check out ${byline} Hotlist: ${hotlist.name} — ${hotlist.books.length} books compared`,
    openGraph: {
      title: `${hotlist.name} — Hotlist`,
      description: `${byline} Hotlist with ${hotlist.books.length} books compared side by side`,
      type: "website",
    },
  };
}

export default async function HotlistDetailPage({ params }: Props) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const hotlist = await getHotlistWithBooks(params.slug, user?.id);

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
