export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { hydrateBookDetail } from "@/lib/books/cache";
import BookCard from "@/components/books/BookCard";
import type { BookDetail, UserRating } from "@/lib/types";
import ReadingListActions from "./ReadingListActions";

type TabKey = "want_to_read" | "reading" | "finished";

const TAB_LABELS: Record<TabKey, string> = {
  want_to_read: "Want to Read",
  reading: "Reading",
  finished: "Finished",
};

const RESPONSE_EMOJI: Record<string, string> = {
  must_read: "🔥",
  loved_it: "❤️",
  it_was_fine: "👍",
  didnt_finish: "💬",
};

interface PageProps {
  searchParams: { tab?: string };
}

interface BookWithRating {
  book: BookDetail;
  userRating: UserRating | null;
  response: string | null;
}

export default async function ReadingPage({ searchParams }: PageProps) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/?login=required");
  }

  const activeTab: TabKey =
    searchParams.tab === "reading" ? "reading" :
    searchParams.tab === "finished" ? "finished" :
    "want_to_read";

  const admin = getAdminClient();

  // Fetch reading statuses for the active tab using new response column
  let statusQuery;
  switch (activeTab) {
    case "want_to_read":
      statusQuery = admin
        .from("reading_status")
        .select("book_id, response")
        .eq("user_id", user.id)
        .in("response", ["must_read", "on_the_shelf"])
        .order("updated_at", { ascending: false });
      break;
    case "reading":
      statusQuery = admin
        .from("reading_status")
        .select("book_id, response")
        .eq("user_id", user.id)
        .eq("is_reading", true)
        .order("updated_at", { ascending: false });
      break;
    case "finished":
      statusQuery = admin
        .from("reading_status")
        .select("book_id, response")
        .eq("user_id", user.id)
        .in("response", ["loved_it", "it_was_fine", "didnt_finish"])
        .order("updated_at", { ascending: false });
      break;
  }

  const { data: statuses } = await statusQuery;
  const booksWithRatings: BookWithRating[] = [];

  if (statuses && statuses.length > 0) {
    const bookIds = statuses.map((s) => s.book_id);
    const responseMap = new Map(statuses.map((s) => [s.book_id, s.response as string | null]));

    // Fetch books and user ratings in parallel
    const [{ data: dbBooks }, { data: userRatings }] = await Promise.all([
      admin.from("books").select("*").in("id", bookIds),
      admin
        .from("user_ratings")
        .select("book_id, star_rating, score, spice_rating, note")
        .eq("user_id", user.id)
        .in("book_id", bookIds),
    ]);

    // Build rating lookup
    const ratingMap = new Map(
      (userRatings ?? []).map((r) => [
        r.book_id,
        {
          starRating: r.star_rating ?? null,
          score: r.score != null ? parseFloat(r.score) : null,
          spiceRating: r.spice_rating ?? null,
          note: r.note ?? null,
        } as UserRating,
      ])
    );

    if (dbBooks) {
      const bookMap = new Map(dbBooks.map((b) => [b.id, b]));
      // Preserve order from statuses query; pin must_read at top in want_to_read tab
      const orderedIds = activeTab === "want_to_read"
        ? [
            ...bookIds.filter((id) => responseMap.get(id) === "must_read"),
            ...bookIds.filter((id) => responseMap.get(id) !== "must_read"),
          ]
        : bookIds;

      for (const id of orderedIds) {
        const dbBook = bookMap.get(id);
        if (dbBook) {
          const hydrated = await hydrateBookDetail(admin, dbBook as Record<string, unknown>);
          booksWithRatings.push({
            book: hydrated,
            userRating: ratingMap.get(id) ?? null,
            response: responseMap.get(id) ?? null,
          });
        }
      }
    }
  }

  // Get counts for all tabs using new columns
  const [wtrCount, readingCount, finishedCount] = await Promise.all([
    admin.from("reading_status").select("id", { count: "exact", head: true }).eq("user_id", user.id).in("response", ["must_read", "on_the_shelf"]),
    admin.from("reading_status").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_reading", true),
    admin.from("reading_status").select("id", { count: "exact", head: true }).eq("user_id", user.id).in("response", ["loved_it", "it_was_fine", "didnt_finish"]),
  ]);

  const counts: Record<TabKey, number> = {
    want_to_read: wtrCount.count ?? 0,
    reading: readingCount.count ?? 0,
    finished: finishedCount.count ?? 0,
  };

  const totalBooks = counts.want_to_read + counts.reading + counts.finished;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink italic">
        My Reading List
      </h1>

      {/* Summary stats */}
      {totalBooks > 0 && (
        <p className="text-sm font-mono text-muted mt-2">
          You&apos;ve finished {counts.finished} book{counts.finished !== 1 ? "s" : ""}
          {counts.want_to_read > 0 && (
            <> &middot; {counts.want_to_read} on your list</>
          )}
          {counts.reading > 0 && (
            <> &middot; {counts.reading} currently reading</>
          )}
        </p>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mt-6 border-b border-border">
        {(["want_to_read", "reading", "finished"] as TabKey[]).map((tab) => (
          <Link
            key={tab}
            href={`/reading?tab=${tab}`}
            className={`px-4 py-2.5 text-sm font-mono transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "text-fire border-fire font-medium"
                : "text-muted border-transparent hover:text-ink"
            }`}
          >
            {TAB_LABELS[tab]}
            {counts[tab] > 0 && (
              <span className="ml-1.5 text-xs text-muted/60">
                {counts[tab]}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* Book list */}
      {booksWithRatings.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-lg font-body text-muted">
            {activeTab === "want_to_read" && "No books on your Want to Read list yet"}
            {activeTab === "reading" && "Not currently reading anything"}
            {activeTab === "finished" && "No finished books yet"}
          </p>
          <p className="text-sm font-body text-muted/60 mt-2">
            Browse books and mark them to build your reading list.
          </p>
          <Link
            href="/"
            className="inline-block mt-6 px-5 py-2.5 bg-fire text-white text-sm font-mono rounded-lg hover:bg-fire/90 transition-colors"
          >
            Browse books
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 mt-6">
          {booksWithRatings.map(({ book, userRating, response }) => (
            <div key={book.id} className="relative group">
              <div className="flex items-start gap-4 px-4 py-3 bg-white border border-border rounded-lg hover:border-fire/20 transition-colors">
                {/* Response emoji badge */}
                {response && RESPONSE_EMOJI[response] && (
                  <span className="shrink-0 text-lg mt-1" title={response.replace(/_/g, " ")}>
                    {RESPONSE_EMOJI[response]}
                  </span>
                )}

                {/* Book card in list layout */}
                <div className="flex-1 min-w-0">
                  <BookCard book={book} layout="list" />
                </div>

                {/* User score display (Finished tab only) */}
                {activeTab === "finished" && (
                  <div className="shrink-0 text-right hidden sm:block">
                    {(userRating?.score ?? userRating?.starRating) ? (
                      <div>
                        <span className="text-lg font-display font-bold text-ink">
                          {(userRating.score ?? userRating.starRating)!.toFixed(1)}
                        </span>
                        <span className="block text-xs font-mono text-muted uppercase">
                          Your Rating
                        </span>
                      </div>
                    ) : (
                      <Link
                        href={`/book/${book.slug}`}
                        className="text-xs font-mono text-fire hover:text-fire/80 transition-colors"
                      >
                        Rate this book &rarr;
                      </Link>
                    )}
                  </div>
                )}

                {/* Remove button */}
                <ReadingListActions bookId={book.id} tab={activeTab === "finished" ? "read" : activeTab === "reading" ? "reading" : "want_to_read"} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
