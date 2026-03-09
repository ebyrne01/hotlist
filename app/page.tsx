import { createClient } from "@supabase/supabase-js";
import HeroSection from "@/components/home/HeroSection";
import TropeGrid from "@/components/home/TropeGrid";
import BookRow from "@/components/books/BookRow";
import { getNYTBestsellerRomance } from "@/lib/books/nyt-lists";
import { getRomanceNewReleases } from "@/lib/books/new-releases";
import { hydrateBookDetail } from "@/lib/books/cache";
import { isJunkTitle } from "@/lib/books/romance-filter";
import type { BookDetail } from "@/lib/types";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * What's Hot: NYT bestsellers filtered to romance/romantasy.
 * Falls back to top-rated books in our DB if NYT returns nothing.
 */
async function getWhatsHot(): Promise<BookDetail[]> {
  try {
    const nytBooks = await getNYTBestsellerRomance();
    if (nytBooks.length > 0) return deduplicateBooks(nytBooks);
  } catch (err) {
    console.warn("[homepage] NYT bestseller fetch failed, falling back:", err);
  }

  // Fallback: top-rated books from our database
  const supabase = getAdminClient();
  const { data: topRated } = await supabase
    .from("book_ratings")
    .select("book_id, rating")
    .not("rating", "is", null);

  if (!topRated || topRated.length === 0) return [];

  const ratingsByBook = new Map<string, number[]>();
  for (const r of topRated) {
    const list = ratingsByBook.get(r.book_id) ?? [];
    list.push(parseFloat(r.rating));
    ratingsByBook.set(r.book_id, list);
  }

  const qualifiedIds: string[] = [];
  const avgMap = new Map<string, number>();
  for (const [bookId, ratings] of Array.from(ratingsByBook)) {
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    if (avg >= 4.0) {
      qualifiedIds.push(bookId);
      avgMap.set(bookId, avg);
    }
  }

  if (qualifiedIds.length === 0) return [];

  const { data: books } = await supabase
    .from("books")
    .select("*")
    .in("id", qualifiedIds)
    .not("cover_url", "is", null);

  if (!books || books.length === 0) return [];

  books.sort((a, b) => (avgMap.get(b.id as string) ?? 0) - (avgMap.get(a.id as string) ?? 0));

  const hydrated: BookDetail[] = [];
  for (const book of books.slice(0, 12) as Record<string, unknown>[]) {
    if (isJunkTitle(book.title as string)) continue;
    hydrated.push(await hydrateBookDetail(supabase, book));
  }
  return hydrated;
}

async function getNewReleases(): Promise<BookDetail[]> {
  try {
    const books = await getRomanceNewReleases();
    return deduplicateBooks(books);
  } catch (err) {
    console.warn("[homepage] New releases fetch failed:", err);
    return [];
  }
}

async function getSpiciest(): Promise<BookDetail[]> {
  const supabase = getAdminClient();

  const { data: spiceRows } = await supabase
    .from("book_spice")
    .select("book_id, spice_level")
    .gte("spice_level", 4)
    .order("spice_level", { ascending: false })
    .limit(12);

  if (!spiceRows || spiceRows.length === 0) return [];

  const bookIds = Array.from(new Set(spiceRows.map((r) => r.book_id)));
  const { data: books } = await supabase
    .from("books")
    .select("*")
    .in("id", bookIds)
    .not("cover_url", "is", null);

  if (!books || books.length === 0) return [];

  const hydrated: BookDetail[] = [];
  for (const book of books as Record<string, unknown>[]) {
    if (isJunkTitle(book.title as string)) continue;
    hydrated.push(await hydrateBookDetail(supabase, book));
  }
  return deduplicateBooks(hydrated);
}

async function getTropes() {
  const supabase = getAdminClient();
  const { data } = await supabase
    .from("tropes")
    .select("id, slug, name")
    .order("sort_order", { ascending: true });
  return data ?? [];
}

/** Deduplicate books by goodreads_id, ISBN, and title+author. */
function deduplicateBooks(books: BookDetail[]): BookDetail[] {
  const seen = new Set<string>();
  const result: BookDetail[] = [];

  for (const book of books) {
    const keys = [
      book.goodreadsId,
      book.isbn,
      book.isbn13,
      book.googleBooksId,
      `${book.title.toLowerCase()}::${book.author.toLowerCase()}`,
    ].filter(Boolean) as string[];

    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));

    if (isJunkTitle(book.title)) continue;

    result.push(book);
  }

  return result;
}

export default async function Home() {
  const [hotBooks, newReleases, spicyBooks, tropes] = await Promise.all([
    getWhatsHot(),
    getNewReleases(),
    getSpiciest(),
    getTropes(),
  ]);

  // Remove any new releases that already appear in What's Hot
  const hotIds = new Set(hotBooks.map((b) => b.id));
  const filteredReleases = newReleases.filter((b) => !hotIds.has(b.id));

  return (
    <>
      <HeroSection />

      <div className="max-w-6xl mx-auto px-4">
        {/* What's Hot — NYT Bestsellers */}
        {hotBooks.length > 0 && (
          <section className="py-8">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-ink mb-4">
              🔥{" "}What&apos;s Hot
            </h2>
            <BookRow books={hotBooks} />
          </section>
        )}

        {/* New Releases */}
        {filteredReleases.length > 0 && (
          <section className="py-8">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-ink mb-4">
              ✨ New Releases
            </h2>
            <BookRow books={filteredReleases} />
          </section>
        )}

        {/* Browse by Trope */}
        <section id="tropes" className="py-8 scroll-mt-20">
          <h2 className="font-display text-xl sm:text-2xl font-bold text-ink mb-4 text-center">
            Browse by Trope
          </h2>
          <TropeGrid tropes={tropes} />
        </section>

        {/* Spiciest Right Now */}
        {spicyBooks.length > 0 && (
          <section className="py-8">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-ink mb-4">
              🌶️{" "}Turn Up the Heat
            </h2>
            <BookRow books={spicyBooks} />
          </section>
        )}

        {/* What is Hotlist explainer */}
        <section className="py-12 border-t border-border">
          <div className="max-w-lg mx-auto text-center">
            <h2 className="font-display text-2xl font-bold text-ink italic">
              What is Hotlist?
            </h2>
            <div className="mt-6 space-y-4 text-left">
              <div className="flex gap-3">
                <span className="text-xl shrink-0">📊</span>
                <p className="text-sm font-body text-muted">
                  <strong className="text-ink">Every rating in one place.</strong> Goodreads, Amazon, and community ratings side by side so you can compare.
                </p>
              </div>
              <div className="flex gap-3">
                <span className="text-xl shrink-0">🌶️</span>
                <p className="text-sm font-body text-muted">
                  <strong className="text-ink">Know the spice before you start.</strong> Spice levels and trope tags so you always know what you&apos;re getting into.
                </p>
              </div>
              <div className="flex gap-3">
                <span className="text-xl shrink-0">🔥</span>
                <p className="text-sm font-body text-muted">
                  <strong className="text-ink">Build your Hotlist.</strong> Save books to a comparison table and decide what to read next.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
