export const dynamic = "force-dynamic";

import { getAdminClient } from "@/lib/supabase/admin";
import { hydrateBookDetail } from "@/lib/books/cache";
import type { BookDetail } from "@/lib/types";
import TropeFilterClient from "./TropeFilterClient";

interface TropePageProps {
  params: { slug: string };
}

export default async function TropePage({ params }: TropePageProps) {
  const supabase = getAdminClient();

  // Find the trope
  const { data: trope } = await supabase
    .from("tropes")
    .select("*")
    .eq("slug", params.slug)
    .single();

  if (!trope) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-ink">Trope not found</h1>
        <p className="text-sm font-body text-muted mt-2">
          We don&apos;t have a trope called &ldquo;{params.slug}&rdquo;
        </p>
      </div>
    );
  }

  // Get books tagged with this trope
  const { data: bookTropes } = await supabase
    .from("book_tropes")
    .select("book_id")
    .eq("trope_id", trope.id);

  const books: BookDetail[] = [];
  const relatedTropeMap = new Map<string, { slug: string; name: string; count: number }>();

  if (bookTropes && bookTropes.length > 0) {
    const bookIds = bookTropes.map((bt) => bt.book_id);

    const { data: dbBooks } = await supabase
      .from("books")
      .select("*")
      .in("id", bookIds)
      .order("updated_at", { ascending: false });

    if (dbBooks && dbBooks.length > 0) {
      for (const dbBook of dbBooks as Record<string, unknown>[]) {
        books.push(await hydrateBookDetail(supabase, dbBook));
      }
    }

    // Find related tropes (other tropes that appear on these books)
    const { data: otherTropes } = await supabase
      .from("book_tropes")
      .select("trope_id, tropes(id, slug, name)")
      .in("book_id", bookIds)
      .neq("trope_id", trope.id);

    if (otherTropes) {
      for (const bt of otherTropes as Record<string, unknown>[]) {
        const t = bt.tropes as Record<string, unknown> | null;
        if (!t) continue;
        const slug = t.slug as string;
        if (!relatedTropeMap.has(slug)) {
          relatedTropeMap.set(slug, {
            slug,
            name: t.name as string,
            count: 0,
          });
        }
        relatedTropeMap.get(slug)!.count++;
      }
    }
  }

  // Sort related tropes by frequency (most common first), take top 15
  const relatedTropes = Array.from(relatedTropeMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // Shape initial books for client
  const initialBooks = books.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    slug: b.slug,
    coverUrl: b.coverUrl,
    goodreadsRating: b.ratings.find((r) => r.source === "goodreads")?.rating ?? null,
    spiceLevel: b.compositeSpice?.score ? Math.round(b.compositeSpice.score) : null,
    tropes: b.tropes.map((t) => t.name),
  }));

  return (
    <TropeFilterClient
      primaryTrope={{
        slug: trope.slug as string,
        name: trope.name as string,
        description: (trope.description as string) ?? null,
      }}
      relatedTropes={relatedTropes}
      initialBooks={initialBooks}
      initialBookCount={books.length}
    />
  );
}
