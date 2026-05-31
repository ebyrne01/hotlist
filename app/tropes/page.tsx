export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { getAdminClient } from "@/lib/supabase/admin";
import TropeGrid from "@/components/home/TropeGrid";

export const metadata: Metadata = {
  title: "Browse Romance Tropes — Hotlist",
  description:
    "Browse romance and romantasy books by trope, from enemies to lovers and slow burn to fae bargains, morally grey leads, and dark romance.",
};

type TropeRow = {
  id: string;
  slug: string;
  name: string;
  book_tropes?: { count: number }[];
};

export default async function TropesIndexPage() {
  const supabase = getAdminClient();

  const { data } = await supabase
    .from("tropes")
    .select("id, slug, name, book_tropes(count)")
    .order("name", { ascending: true });

  const tropes = ((data ?? []) as TropeRow[]).map((trope) => ({
    id: trope.id,
    slug: trope.slug,
    name: trope.name,
    bookCount: trope.book_tropes?.[0]?.count ?? 0,
  }));

  return (
    <main className="surface-parchment">
      <section className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-fire">
            Choose your craving
          </p>
          <h1 className="mt-2 font-display text-4xl font-bold leading-tight tracking-[-0.04em] text-ink sm:text-5xl">
            Browse by trope
          </h1>
          <p className="mt-4 font-body text-base leading-relaxed text-muted-a11y">
            Start with the promise you want: slow burn, fae bargains,
            morally grey obsession, or a cozy little disaster with excellent
            banter.
          </p>
        </div>

        <div className="mt-10 rounded-3xl border border-aged-gold/30 bg-white/70 px-4 py-6 shadow-sm sm:px-8">
          {tropes.length > 0 ? (
            <TropeGrid tropes={tropes} />
          ) : (
            <div className="py-12 text-center">
              <p className="font-display text-xl font-bold text-ink">
                Tropes are still loading.
              </p>
              <p className="mt-2 font-body text-sm text-muted-a11y">
                Search by title or author while we gather the shelves.
              </p>
            </div>
          )}
        </div>

        <div className="mt-8 text-center">
          <Link
            href="/"
            className="font-mono text-xs uppercase tracking-[0.14em] text-fire transition-colors hover:text-fire/80"
          >
            Search all books instead &rarr;
          </Link>
        </div>
      </section>
    </main>
  );
}
