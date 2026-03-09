import { createClient } from "@supabase/supabase-js";
import BookCard from "@/components/books/BookCard";
import { hydrateBookDetail } from "@/lib/books/cache";
import type { BookDetail } from "@/lib/types";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Pre-generate pages for all 25 tropes
export async function generateStaticParams() {
  const supabase = getAdminClient();
  const { data } = await supabase.from("tropes").select("slug");
  return (data ?? []).map((t) => ({ slug: t.slug }));
}

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
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink italic">
          {trope.name}
        </h1>
        {trope.description && (
          <p className="mt-2 text-sm font-body text-muted max-w-lg">
            {trope.description}
          </p>
        )}
        <p className="mt-1 text-xs font-mono text-muted/60">
          {books.length} book{books.length !== 1 ? "s" : ""} tagged
        </p>
      </header>

      {books.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-lg font-body text-muted">
            No books tagged with {trope.name} yet
          </p>
          <p className="text-sm font-body text-muted/60 mt-2">
            Search for books and they&apos;ll appear here as we discover their tropes
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {books.map((book) => (
            <BookCard key={book.id} book={book} layout="list" />
          ))}
        </div>
      )}
    </div>
  );
}
