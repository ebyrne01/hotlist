/**
 * POST /api/reading-dna/recompute
 *
 * Triggers DNA recomputation after a rating or reading status change.
 * Body: { bookId: string, signalType: string, weight: number }
 *
 * Fire-and-forget from client — saves signal, recomputes DNA if user has one.
 */

import { createClient } from "@/lib/supabase/server";
import { saveSignals, recomputeDna, getDna } from "@/lib/reading-dna";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = await request.json();
  const { bookId, signalType, weight } = body as {
    bookId: string;
    signalType: string;
    weight: number;
  };

  if (!bookId || !signalType || typeof weight !== "number") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Save signal
  await saveSignals(user.id, [{ bookId, signalType, weight }]);

  // Only recompute if user already has DNA (don't create DNA from a single rating)
  const existing = await getDna(user.id);
  if (existing) {
    await recomputeDna(user.id);
  }

  return NextResponse.json({ ok: true });
}
