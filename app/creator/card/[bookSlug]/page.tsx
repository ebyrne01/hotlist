/**
 * /creator/card/[bookSlug]
 *
 * Server page: loads book data + existing card, verifies creator status,
 * then renders the interactive card editor.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getBookDetail } from "@/lib/books";
import CardEditorClient from "./CardEditorClient";

interface PageProps {
  params: { bookSlug: string };
}

export default async function CardEditorPage({ params }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/profile/creator");

  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("is_creator, vanity_slug, display_name, amazon_affiliate_tag")
    .eq("id", user.id)
    .single();

  if (!profile?.is_creator) redirect("/profile/creator");

  // Load book
  const book = await getBookDetail(params.bookSlug);
  if (!book) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-ink">Book not found</h1>
        <p className="text-muted mt-2">We couldn&apos;t find a book with that slug.</p>
      </div>
    );
  }

  // Load existing card for this creator + book (if editing)
  const { data: existingCard } = await admin
    .from("creator_share_cards")
    .select("*")
    .eq("creator_id", user.id)
    .eq("book_id", book.id)
    .single();

  // Get the current spice level from composite or best signal
  const currentSpice = book.compositeSpice?.score
    ? Math.round(book.compositeSpice.score)
    : 0;
  const spiceSource = book.compositeSpice?.primarySource ?? null;

  // Prepare book data for the client
  const bookData = {
    id: book.id,
    title: book.title,
    author: book.author,
    slug: book.slug,
    coverUrl: book.coverUrl,
    goodreadsRating:
      book.ratings.find((r) => r.source === "goodreads")?.rating ?? null,
    amazonRating:
      book.ratings.find((r) => r.source === "amazon")?.rating ?? null,
    spiceLevel: currentSpice,
    spiceSource,
    tropes: book.tropes.map((t) => t.name),
  };

  // Load all canonical tropes for the "add trope" search
  const { data: allTropesRaw } = await admin
    .from("tropes")
    .select("name")
    .order("name");
  const allTropes = (allTropesRaw ?? []).map((t: Record<string, unknown>) => t.name as string);

  const existingCardData = existingCard
    ? {
        id: existingCard.id as string,
        spiceOverride: existingCard.spice_override as number | null,
        tropesSelected: (existingCard.tropes_selected as string[]) ?? [],
        creatorQuote: existingCard.creator_quote as string | null,
        aspectRatio: (existingCard.aspect_ratio as string) ?? "9:16",
      }
    : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <CardEditorClient
        book={bookData}
        creatorHandle={profile.vanity_slug ?? profile.display_name ?? ""}
        existingCard={existingCardData}
        allTropes={allTropes}
      />
    </div>
  );
}
