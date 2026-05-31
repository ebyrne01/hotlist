export const dynamic = "force-dynamic";

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { hydrateBookDetail } from "@/lib/books/cache";
import BookCard from "@/components/books/BookCard";
import type { BookDetail, UserRating } from "@/lib/types";
import ReadingListActions from "./ReadingListActions";
import SignInPrompt from "@/components/auth/SignInPrompt";

type TabKey = "want_to_read" | "reading" | "finished";

const TAB_LABELS: Record<TabKey, string> = {
  want_to_read: "Want to Read",
  reading: "Reading",
  finished: "Finished",
};

const RESPONSE_LABELS: Record<string, { label: string; className: string }> = {
  must_read: {
    label: "Must read",
    className: "border-fire/25 bg-fire/10 text-fire",
  },
  on_the_shelf: {
    label: "On the shelf",
    className: "border-aged-gold/40 bg-parchment text-muted-a11y",
  },
  loved_it: {
    label: "Loved it",
    className: "border-fire/25 bg-fire/10 text-fire",
  },
  it_was_fine: {
    label: "It was fine",
    className: "border-aged-gold/40 bg-parchment text-muted-a11y",
  },
  didnt_finish: {
    label: "DNF",
    className: "border-oxblood/20 bg-oxblood/5 text-oxblood",
  },
};

const EMPTY_COPY: Record<TabKey, { title: string; body: string }> = {
  want_to_read: {
    title: "Your future favorites can live here.",
    body: "Save books from search, book pages, or BookTok grabs and your shelf will start to feel deliciously intentional.",
  },
  reading: {
    title: "Nothing currently open.",
    body: "Mark a book as reading when it has officially escaped the TBR and moved onto your nightstand.",
  },
  finished: {
    title: "No finished books yet.",
    body: "Rate a few reads as you finish them and Hotlist will use that taste signal to sharpen your recommendations.",
  },
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
    return (
      <SignInPrompt
        eyebrow="Your shelf"
        title="Save the books you keep thinking about."
        body="Sign in to keep a want-to-read shelf, track what you are reading, and turn finished books into better recommendations."
        context={{
          title: "Save your reading list.",
          subtitle: "Sign in free so your shelf follows you.",
          note: "We will bring you right back to your reading list.",
        }}
        secondaryHref="/booktok"
        secondaryLabel="Grab from BookTok"
      />
    );
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

  const emptyCopy = EMPTY_COPY[activeTab];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <header className="surface-parchment -mx-4 -mt-8 border-b border-aged-gold/30 px-4 py-9 sm:mx-0 sm:mt-0 sm:rounded-3xl sm:border sm:px-8 sm:py-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-aged-gold">
          Your shelf
        </p>
        <div className="mt-2 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-4xl font-bold leading-tight text-ink sm:text-5xl">
              Your reading life, organized.
            </h1>
            <p className="mt-3 max-w-2xl text-sm font-body leading-6 text-muted-a11y sm:text-base">
              Keep the next obsession, current fixation, and finished verdicts in one place.
            </p>
          </div>
          {totalBooks > 0 && (
            <div className="grid grid-cols-3 gap-2 rounded-2xl border border-aged-gold/30 bg-white/70 p-2 shadow-sm sm:min-w-[320px]">
              {(["want_to_read", "reading", "finished"] as TabKey[]).map((tab) => (
                <div key={tab} className="rounded-xl bg-cream/80 px-3 py-2 text-center">
                  <p className="font-display text-2xl font-bold text-ink">{counts[tab]}</p>
                  <p className="mt-0.5 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-a11y">
                    {tab === "want_to_read" ? "Saved" : TAB_LABELS[tab]}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      <nav className="mt-6 grid grid-cols-3 gap-2 rounded-2xl border border-aged-gold/30 bg-white/70 p-2 shadow-sm" aria-label="Reading list sections">
        {(["want_to_read", "reading", "finished"] as TabKey[]).map((tab) => (
          <Link
            key={tab}
            href={`/reading?tab=${tab}`}
            className={`inline-flex min-h-12 flex-col items-center justify-center rounded-xl px-2 py-2 text-center text-xs font-mono uppercase tracking-[0.12em] transition-colors sm:flex-row sm:gap-2 ${
              activeTab === tab
                ? "bg-fire text-white shadow-sm"
                : "text-muted-a11y hover:bg-parchment hover:text-ink"
            }`}
          >
            {TAB_LABELS[tab]}
            {counts[tab] > 0 && (
              <span className={activeTab === tab ? "text-white/80" : "text-muted-a11y/70"}>
                {counts[tab]}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {booksWithRatings.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-aged-gold/30 bg-white p-8 text-center shadow-sm sm:p-10">
          <p className="font-display text-2xl font-bold text-ink">
            {emptyCopy.title}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm font-body leading-6 text-muted-a11y">
            {emptyCopy.body}
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/search"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-fire px-5 py-2 text-sm font-mono text-white transition-colors hover:bg-fire/90"
            >
              Find books
            </Link>
            <Link
              href="/booktok"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-aged-gold/30 bg-cream px-5 py-2 text-sm font-mono text-muted-a11y transition-colors hover:border-fire/30 hover:text-fire"
            >
              Grab from BookTok
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3">
          {booksWithRatings.map(({ book, userRating, response }) => (
            <div key={book.id} className="relative group">
              <div className="flex items-start gap-3 rounded-2xl border border-aged-gold/30 bg-white px-3 py-3 shadow-sm transition-colors hover:border-fire/25 sm:gap-4 sm:px-4">
                {response && RESPONSE_LABELS[response] && (
                  <span className={`mt-1 hidden shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] sm:inline-flex ${RESPONSE_LABELS[response].className}`}>
                    {RESPONSE_LABELS[response].label}
                  </span>
                )}

                <div className="flex-1 min-w-0">
                  {response && RESPONSE_LABELS[response] && (
                    <span className={`mb-2 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] sm:hidden ${RESPONSE_LABELS[response].className}`}>
                      {RESPONSE_LABELS[response].label}
                    </span>
                  )}
                  <BookCard book={book} layout="list" />
                </div>

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
                        className="inline-flex min-h-9 items-center text-xs font-mono text-fire transition-colors hover:text-fire/80"
                      >
                        Rate this book &rarr;
                      </Link>
                    )}
                  </div>
                )}

                <ReadingListActions bookId={book.id} tab={activeTab === "finished" ? "read" : activeTab === "reading" ? "reading" : "want_to_read"} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
