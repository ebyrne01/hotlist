export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getAdminClient } from "@/lib/supabase/admin";
import { hydrateBookDetail } from "@/lib/books/cache";
import { deduplicateBooks, isCompilationTitle } from "@/lib/books/utils";
import { isJunkTitle } from "@/lib/books/romance-filter";
import type { BookDetail } from "@/lib/types";
import TropeFilterClient from "./TropeFilterClient";

interface TropePageProps {
  params: { slug: string };
}

function deduplicateByTitleAuthor(books: BookDetail[]): BookDetail[] {
  const seen = new Map<string, BookDetail>();
  for (const book of books) {
    const key = `${book.title.toLowerCase().trim()}::${book.author.toLowerCase().trim()}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, book);
    } else {
      const existingRatings = existing.ratings.reduce((sum, r) => sum + (r.ratingCount ?? 0), 0);
      const bookRatings = book.ratings.reduce((sum, r) => sum + (r.ratingCount ?? 0), 0);
      if (bookRatings > existingRatings) {
        seen.set(key, book);
      }
    }
  }
  return Array.from(seen.values());
}

export async function generateMetadata({ params }: TropePageProps): Promise<Metadata> {
  const supabase = getAdminClient();
  const { data: trope } = await supabase
    .from("tropes")
    .select("name, description")
    .eq("slug", params.slug)
    .single();

  if (!trope) {
    return { title: "Trope Not Found — Hotlist" };
  }

  const title = `${trope.name} Romance Books — Hotlist`;
  const description = trope.description
    ? `${trope.description} Browse ${trope.name} books with spice levels, ratings, and trope tags.`
    : `Browse ${trope.name} romance and romantasy books. Compare spice levels, ratings, and tropes on Hotlist.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
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

  // Get total count of books tagged with this trope
  const { count: totalBookCount } = await supabase
    .from("book_tropes")
    .select("book_id", { count: "exact", head: true })
    .eq("trope_id", trope.id);

  const books: BookDetail[] = [];
  const relatedTropeMap = new Map<string, { slug: string; name: string; count: number }>();
  const PAGE_SIZE = 50;

  if (totalBookCount && totalBookCount > 0) {
    // Fetch books via a join-style query: get book_tropes rows with limit,
    // then fetch the corresponding books. This avoids passing hundreds of
    // UUIDs into .in() which exceeds PostgREST URL length limits.
    const { data: bookTropes } = await supabase
      .from("book_tropes")
      .select("book_id")
      .eq("trope_id", trope.id)
      .limit(PAGE_SIZE);

    const bookIds = (bookTropes ?? []).map((bt) => bt.book_id as string);

    if (bookIds.length > 0) {
      const { data: dbBooks } = await supabase
        .from("books")
        .select("*")
        .in("id", bookIds)
        .eq("is_canon", true)
        .order("updated_at", { ascending: false });

      if (dbBooks && dbBooks.length > 0) {
        for (const dbBook of dbBooks as Record<string, unknown>[]) {
          books.push(await hydrateBookDetail(supabase, dbBook));
        }
      }
    }

    // Find related tropes — sample from the first batch of book IDs
    if (bookIds.length > 0) {
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
  }

  // Sort related tropes by frequency (most common first), take top 15
  const relatedTropes = Array.from(relatedTropeMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // Deduplicate and filter junk
  const dedupedBooks = deduplicateBooks(books);
  const cleanBooks = deduplicateByTitleAuthor(dedupedBooks).filter((book) => {
    if (isJunkTitle(book.title)) return false;
    if (isCompilationTitle(book.title)) return false;
    if (/\[.*\]/.test(book.title) && book.title.includes("Author:")) return false;
    if (book.title.length > 100) return false;
    return true;
  });

  // Shape initial books for client
  const initialBooks = cleanBooks.map((b) => {
    // Sanitize bad cover URLs so the fallback renders cleanly
    let coverUrl = b.coverUrl;
    if (
      coverUrl &&
      (coverUrl.includes("nophoto") ||
        coverUrl.includes("no-cover") ||
        coverUrl.includes("placeholder"))
    ) {
      coverUrl = null;
    }

    return {
      id: b.id,
      title: b.title,
      author: b.author,
      slug: b.slug,
      coverUrl,
      goodreadsRating: b.ratings.find((r) => r.source === "goodreads")?.rating ?? null,
      spiceLevel: b.compositeSpice?.score ? Math.round(b.compositeSpice.score) : null,
      tropes: b.tropes.map((t) => t.name),
    };
  });

  return (
    <TropeFilterClient
      primaryTrope={{
        slug: trope.slug as string,
        name: trope.name as string,
        description: (trope.description as string) ?? null,
      }}
      relatedTropes={relatedTropes}
      initialBooks={initialBooks}
      initialBookCount={cleanBooks.length}
    />
  );
}
