/**
 * POST /api/reading-dna
 *
 * Save quiz results and compute initial Reading DNA.
 * Body: { spiceLevel: number, tropeSelections: string[], bookSelections: string[] }
 */

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  saveSignals,
  saveDna,
  SIGNAL_WEIGHTS,
} from "@/lib/reading-dna";
import { buildDnaProfile, type DnaSignal } from "@/lib/reading-dna/compute";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { spiceLevel, tropeSelections, bookSelections } = body as {
    spiceLevel: number;
    tropeSelections: string[];
    bookSelections: string[];
  };

  // Validate
  if (
    typeof spiceLevel !== "number" ||
    spiceLevel < 1 ||
    spiceLevel > 5 ||
    !Array.isArray(tropeSelections) ||
    tropeSelections.length < 3 ||
    !Array.isArray(bookSelections) ||
    bookSelections.length < 5
  ) {
    return NextResponse.json(
      { error: "Invalid quiz data. Need spice (1-5), 3+ tropes, 5+ books." },
      { status: 400 }
    );
  }

  const admin = getAdminClient();

  // Get trope vectors for selected books
  const { data: vectorRows } = await admin
    .from("book_trope_vectors")
    .select("book_id, vector")
    .in("book_id", bookSelections);

  // If no vectors exist yet, build them on the fly from book_tropes
  let vectorMap = new Map<string, Record<string, number>>();
  if (vectorRows && vectorRows.length > 0) {
    for (const row of vectorRows) {
      vectorMap.set(row.book_id, row.vector as Record<string, number>);
    }
  }

  // For books missing vectors, query book_tropes directly
  const missingIds = bookSelections.filter((id) => !vectorMap.has(id));
  if (missingIds.length > 0) {
    const { data: btRows } = await admin
      .from("book_tropes")
      .select("book_id, tropes(slug)")
      .in("book_id", missingIds);

    const tropesByBook = new Map<string, string[]>();
    for (const bt of (btRows ?? []) as Record<string, unknown>[]) {
      const bookId = bt.book_id as string;
      const tropeData = bt.tropes as { slug: string } | null;
      if (!tropeData) continue;
      const list = tropesByBook.get(bookId) ?? [];
      list.push(tropeData.slug);
      tropesByBook.set(bookId, list);
    }

    for (const [bookId, slugs] of Array.from(tropesByBook.entries())) {
      const vector: Record<string, number> = {};
      for (const slug of slugs) vector[slug] = 1.0;
      vectorMap.set(bookId, vector);
    }
  }

  // Build signals
  const signals: { bookId: string; signalType: string; weight: number }[] =
    bookSelections.map((bookId) => ({
      bookId,
      signalType: "quiz_pick",
      weight: SIGNAL_WEIGHTS.quiz_pick,
    }));

  // Save signals
  await saveSignals(user.id, signals);

  // Build DNA profile
  const dnaSignals: DnaSignal[] = bookSelections
    .filter((id) => vectorMap.has(id))
    .map((id) => ({
      bookId: id,
      weight: SIGNAL_WEIGHTS.quiz_pick,
      tropes: Object.keys(vectorMap.get(id)!),
    }));

  const profile = buildDnaProfile(dnaSignals, spiceLevel, []);
  await saveDna(user.id, profile, "quiz");

  return NextResponse.json({ success: true, signalCount: profile.signalCount });
}
