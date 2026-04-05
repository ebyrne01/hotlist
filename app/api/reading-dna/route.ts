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
import { generateDnaBlurb } from "@/lib/reading-dna/generate-blurb";
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
  const { spiceLevel, tropeSelections, bookSelections, dislikedBooks, cwPreferences } = body as {
    spiceLevel: number;
    tropeSelections: string[];
    bookSelections: string[];
    dislikedBooks?: string[];
    cwPreferences?: string[];
  };

  // Validate
  if (
    typeof spiceLevel !== "number" ||
    spiceLevel < 1 ||
    spiceLevel > 5 ||
    !Array.isArray(tropeSelections) ||
    tropeSelections.length < 3 ||
    !Array.isArray(bookSelections) ||
    bookSelections.length < 3
  ) {
    return NextResponse.json(
      { error: "Invalid quiz data. Need spice (1-5), 3+ tropes, 3+ books." },
      { status: 400 }
    );
  }

  const admin = getAdminClient();

  // Clear previous quiz picks so retake is a clean slate for quiz signals.
  // Organic signals (rating, reading_status) are preserved.
  await admin
    .from("reading_dna_signals")
    .delete()
    .eq("user_id", user.id)
    .eq("signal_type", "quiz_pick");

  // Get trope vectors for selected books
  const { data: vectorRows } = await admin
    .from("book_trope_vectors")
    .select("book_id, vector")
    .in("book_id", bookSelections);

  // If no vectors exist yet, build them on the fly from book_tropes
  const vectorMap = new Map<string, Record<string, number>>();
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

  // Build signals — positive picks + disliked books (zero weight)
  const signals: { bookId: string; signalType: string; weight: number }[] =
    bookSelections.map((bookId) => ({
      bookId,
      signalType: "quiz_pick",
      weight: SIGNAL_WEIGHTS.quiz_pick,
    }));

  if (dislikedBooks && dislikedBooks.length > 0) {
    for (const bookId of dislikedBooks) {
      signals.push({
        bookId,
        signalType: "quiz_pick",
        weight: 0.0,
      });
    }
  }

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

  // Generate AI blurb (non-blocking to DNA save — if this fails, DNA is still saved)
  try {
    // Get top 5 trope affinities
    const sortedTropes = Object.entries(profile.tropeAffinities)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([slug, score]) => ({ slug, score }));

    // Look up trope display names
    const { data: tropeNameRows } = await admin
      .from("tropes")
      .select("slug, name")
      .in(
        "slug",
        sortedTropes.map((t) => t.slug)
      );

    const tropeNameMap = new Map<string, string>();
    for (const row of tropeNameRows ?? []) {
      tropeNameMap.set(row.slug as string, row.name as string);
    }

    // Look up book titles
    const { data: bookTitleRows } = await admin
      .from("books")
      .select("id, title")
      .in("id", bookSelections);

    const bookTitles = (bookTitleRows ?? []).map((b) => b.title as string);

    const blurb = await generateDnaBlurb({
      topTropes: sortedTropes.map((t) => ({
        name: tropeNameMap.get(t.slug) ?? t.slug,
        score: t.score,
      })),
      spicePreferred: profile.spicePreferred,
      bookTitles,
    });

    if (blurb) {
      await admin
        .from("reading_dna")
        .update({ dna_description: blurb })
        .eq("user_id", user.id);
    }
  } catch (err) {
    console.error("[reading-dna] Blurb generation failed (DNA still saved):", err);
  }

  // Save content warning preferences (clear previous on retake)
  if (cwPreferences && cwPreferences.length > 0) {
    await admin
      .from("user_cw_preferences")
      .delete()
      .eq("user_id", user.id);

    await admin.from("user_cw_preferences").insert(
      cwPreferences.map((cw: string) => ({
        user_id: user.id,
        cw_category: cw,
      }))
    );
  } else {
    // Clear on retake if user skipped/deselected all
    await admin
      .from("user_cw_preferences")
      .delete()
      .eq("user_id", user.id);
  }

  return NextResponse.json({ success: true, signalCount: profile.signalCount });
}
