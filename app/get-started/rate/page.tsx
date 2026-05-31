import type { Metadata } from "next";
import { getAdminClient } from "@/lib/supabase/admin";
import BookPicker from "@/components/onboarding/BookPicker";

export const metadata: Metadata = {
  title: "Rate Some Books — Hotlist",
  description: "Rate books you've read to build your taste profile and get personalized recommendations.",
};

interface PickerBook {
  id: string;
  title: string;
  author: string;
  coverUrl: string;
  slug: string;
}

export default async function RateBooksPage() {
  const supabase = getAdminClient();

  // Fetch popular canon books by Goodreads rating count
  const { data: topRated } = await supabase
    .from("book_ratings")
    .select("book_id, rating_count")
    .eq("source", "goodreads")
    .not("rating_count", "is", null)
    .order("rating_count", { ascending: false })
    .limit(100);

  const topBookIds = (topRated ?? []).map((r) => r.book_id as string);

  const { data: rows } = topBookIds.length > 0
    ? await supabase
        .from("books")
        .select("id, title, author, cover_url, slug")
        .in("id", topBookIds)
        .eq("is_canon", true)
        .not("cover_url", "is", null)
        .limit(30)
    : { data: [] };

  // Sort by the original popularity order
  const orderMap = new Map(topBookIds.map((id, i) => [id, i]));
  const sortedRows = (rows ?? []).sort(
    (a, b) => (orderMap.get(a.id as string) ?? 999) - (orderMap.get(b.id as string) ?? 999)
  );

  const books: PickerBook[] = sortedRows
    .filter((r) => r.cover_url && r.title && r.author && r.slug)
    .map((r) => ({
      id: r.id as string,
      title: r.title as string,
      author: r.author as string,
      coverUrl: r.cover_url as string,
      slug: r.slug as string,
    }));

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
      <div className="text-center mb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-fire">
          Recommended path
        </p>
        <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold text-ink">
          Rate a few books you know.
        </h1>
        <p className="text-sm font-body leading-6 text-muted-a11y mt-3 max-w-lg mx-auto">
          Favorites, hard passes, and maybes all count. Ten quick taps gives
          Hotlist enough signal to start shaping your Reading DNA.
        </p>
      </div>

      <BookPicker books={books} />
    </div>
  );
}
