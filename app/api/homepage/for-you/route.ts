import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getDna } from "@/lib/reading-dna";
import { rankBooks, type BookVector } from "@/lib/reading-dna/score";
import { hydrateBookDetailBatch } from "@/lib/books/cache";
import type { BookDetail } from "@/lib/types";

/**
 * GET /api/homepage/for-you
 * Returns personalized book recommendations based on the user's Reading DNA.
 * Session-based auth via cookie — returns 401 if not logged in.
 */
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ books: [], hasDna: false }, { status: 401 });
  }

  try {
    const dna = await getDna(user.id);
    if (!dna) {
      return NextResponse.json({ books: [], hasDna: false });
    }

    const admin = getAdminClient();
    const { data: vectorRows } = await admin
      .from("book_trope_vectors")
      .select("book_id, vector")
      .limit(200);

    if (!vectorRows || vectorRows.length === 0) {
      return NextResponse.json({ books: [], hasDna: true });
    }

    const bookVectors: BookVector[] = vectorRows.map((v) => ({
      bookId: v.book_id as string,
      vector: v.vector as Record<string, number>,
      spiceLevel: null,
    }));

    const ranked = rankBooks(
      {
        tropeAffinities: dna.tropeAffinities,
        spicePreferred: dna.spicePreferred,
        spiceTolerance: dna.spiceTolerance,
        signalCount: dna.signalCount,
      },
      bookVectors,
      20
    );

    const topIds = ranked.map((r) => r.bookId);
    if (topIds.length === 0) {
      return NextResponse.json({ books: [], hasDna: true });
    }

    const { data: dbBooks } = await admin
      .from("books")
      .select("*")
      .in("id", topIds)
      .eq("is_canon", true);

    if (!dbBooks || dbBooks.length === 0) {
      return NextResponse.json({ books: [], hasDna: true });
    }

    const batchMap = await hydrateBookDetailBatch(admin, dbBooks as Record<string, unknown>[]);
    const hydrated = Array.from(batchMap.values());

    const idOrder = new Map(topIds.map((id, i) => [id, i]));
    const forYouBooks = hydrated
      .filter((b: BookDetail) => b.coverUrl && b.tropes.length > 0)
      .sort((a: BookDetail, b: BookDetail) =>
        (idOrder.get(a.id) ?? 99) - (idOrder.get(b.id) ?? 99)
      )
      .slice(0, 10);

    return NextResponse.json({ books: forYouBooks, hasDna: true });
  } catch (err) {
    console.warn("[homepage/for-you] Failed:", err);
    return NextResponse.json({ books: [], hasDna: false });
  }
}
