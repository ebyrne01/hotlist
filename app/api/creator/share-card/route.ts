/**
 * POST /api/creator/share-card
 *
 * Create or update a share card for a book.
 * Only verified creators can create share cards.
 */

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  bookId: z.string().uuid(),
  spiceOverride: z.number().int().min(1).max(5).nullable(),
  tropesSelected: z.array(z.string()).max(4).default([]),
  creatorQuote: z.string().max(140).nullable().default(null),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  sourceVideoUrl: z.string().url().nullable().optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Auth: get current user
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Check creator status
    const admin = getAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("is_creator, vanity_slug")
      .eq("id", user.id)
      .single();

    if (!profile?.is_creator) {
      return NextResponse.json(
        { error: "Only verified creators can create share cards" },
        { status: 403 }
      );
    }

    // Validate body
    const body = await request.json();
    const parsed = bodySchema.parse(body);

    // Verify book exists
    const { data: book } = await admin
      .from("books")
      .select("id")
      .eq("id", parsed.bookId)
      .single();

    if (!book) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }

    // Validate tropes exist in the canonical tropes table
    if (parsed.tropesSelected.length > 0) {
      const { data: canonicalTropes } = await admin
        .from("tropes")
        .select("name")
        .in("name", parsed.tropesSelected);

      const validTropes = new Set(
        (canonicalTropes ?? []).map((t: Record<string, unknown>) => t.name as string)
      );

      const invalidTropes = parsed.tropesSelected.filter((t) => !validTropes.has(t));
      if (invalidTropes.length > 0) {
        return NextResponse.json(
          { error: `Invalid tropes: ${invalidTropes.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Upsert the share card (one per creator per book)
    const { data: card, error: cardError } = await admin
      .from("creator_share_cards")
      .upsert(
        {
          creator_id: user.id,
          book_id: parsed.bookId,
          spice_override: parsed.spiceOverride,
          tropes_selected: parsed.tropesSelected,
          creator_quote: parsed.creatorQuote,
          aspect_ratio: parsed.aspectRatio,
          source_video_url: parsed.sourceVideoUrl ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "creator_id,book_id" }
      )
      .select("id")
      .single();

    if (cardError || !card) {
      console.error("[share-card] Upsert failed:", cardError?.message);
      return NextResponse.json({ error: "Failed to save card" }, { status: 500 });
    }

    // If spice override provided, upsert into spice_signals
    if (parsed.spiceOverride !== null) {
      await admin.from("spice_signals").upsert(
        {
          book_id: parsed.bookId,
          source: "creator",
          spice_value: parsed.spiceOverride,
          confidence: 0.85,
          evidence: {
            creator_id: user.id,
            creator_handle: profile.vanity_slug,
            card_id: card.id,
            override_reason: "share_card_creation",
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "book_id,source" }
      );
    }

    return NextResponse.json({
      ok: true,
      cardId: card.id,
      previewUrl: `/api/creator/share-card/${card.id}/preview`,
      exportUrl: `/api/creator/share-card/${card.id}/image`,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: err.issues },
        { status: 400 }
      );
    }
    console.error("[share-card] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
