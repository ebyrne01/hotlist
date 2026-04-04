/**
 * AI-powered book recommendations using Claude Haiku.
 *
 * Unlike trope-matching (which treats "enemies-to-lovers" in romantasy and
 * contemporary romance as equivalent), this uses Haiku's world knowledge to
 * recommend books that actually feel like the source book — matching on
 * subgenre, tone, spice level, themes, and reader expectations.
 *
 * Results are cached in the `book_recommendations` table. One Haiku call
 * per book (~$0.001), never regenerated unless explicitly requested.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAdminClient } from "@/lib/supabase/admin";

const MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_DAILY_LIMIT = 25;

async function getDailyUsage(): Promise<number> {
  const supabase = getAdminClient();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("book_recommendations")
    .select("*", { count: "exact", head: true })
    .gte("created_at", todayStart.toISOString());

  if (error) {
    console.error("[ai-recommendations] Daily usage count failed, refusing to proceed:", error.message);
    return Infinity;
  }

  return count ?? 0;
}

const SYSTEM_PROMPT = `You are a romance and romantasy book recommendation engine for Hotlist, \
a BookTok-oriented reading app. Your audience is romance/romantasy readers who care about \
subgenre, tropes, spice level, and tone.

When recommending books, match on:
1. **Subgenre fit** — romantasy readers want romantasy, not contemporary. Dark romance readers \
want dark romance, not sweet rom-com. This is the most important signal.
2. **Tone and vibe** — angsty vs. lighthearted, fast-paced vs. slow-burn, gritty vs. cozy
3. **Spice level** — match roughly. A 4-pepper book's readers don't want a fade-to-black rec.
4. **Trope affinity** — shared tropes matter, but only within the right subgenre
5. **Reader crossover** — books that the same readers actually love (BookTok overlap, "if you \
liked X" lists)

Never recommend:
- The same author's other books in the same series (the user is already on that book's page)
- Study guides, summaries, or companion books
- Books by authors outside romance/romantasy (no Danielle Steel, James Patterson, Jodi Picoult)
- Box sets or compilations

Return EXACTLY a JSON array of objects. Each object has:
- "title": exact book title (no series info in parentheses)
- "author": author name
- "reason": 1 short sentence explaining why this reader would love it (use "you" voice)

Return 12-15 recommendations, ordered by strongest fit first.`;

interface AiRecommendation {
  title: string;
  author: string;
  reason: string;
}

export async function generateRecommendations(book: {
  id: string;
  title: string;
  author: string;
  description: string | null;
  genres: string[];
  seriesName: string | null;
  tropes: string[];
  spiceLevel: number | null;
}): Promise<void> {
  const supabase = getAdminClient();

  // Check if we already have recommendations
  const { count: existing } = await supabase
    .from("book_recommendations")
    .select("*", { count: "exact", head: true })
    .eq("book_id", book.id);

  if (existing && existing > 0) {
    console.log(`[ai-recommendations] Already have recs for "${book.title}", skipping`);
    return;
  }

  // Check daily limit
  const dailyLimit = Number(process.env.AI_RECOMMENDATIONS_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;
  const usage = await getDailyUsage();
  if (usage >= dailyLimit) {
    console.log(`[ai-recommendations] Daily limit reached (${usage}/${dailyLimit}), skipping`);
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  const client = new Anthropic({ apiKey });

  const spiceStr = book.spiceLevel ? `Spice level: ${book.spiceLevel}/5` : "";
  const tropeStr = book.tropes.length > 0 ? `Tropes: ${book.tropes.join(", ")}` : "";
  const genreStr = book.genres.length > 0 ? `Genres: ${book.genres.join(", ")}` : "";
  const seriesStr = book.seriesName ? `Series: ${book.seriesName}` : "";

  const userPrompt = [
    `Title: ${book.title}`,
    `Author: ${book.author}`,
    seriesStr,
    genreStr,
    tropeStr,
    spiceStr,
    book.description ? `Description: ${book.description.slice(0, 500)}` : "",
    "",
    "Recommend 12-15 books for readers who loved this book. Return JSON only.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : null;
    if (!raw) return;

    // Extract JSON from response (may have markdown fences)
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn(`[ai-recommendations] No JSON array in response for "${book.title}"`);
      return;
    }

    const recs: AiRecommendation[] = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(recs) || recs.length === 0) return;

    // Resolve each recommendation to a book in our database
    const rows: Array<{
      book_id: string;
      recommended_book_id: string;
      reason: string;
      position: number;
    }> = [];

    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      if (!rec.title || !rec.author) continue;

      // Search our DB for this book — try exact title+author first, then fuzzy
      const { data: matches } = await supabase
        .from("books")
        .select("id, title, author, cover_url")
        .ilike("title", rec.title)
        .limit(5);

      let matchId: string | null = null;

      if (matches && matches.length > 0) {
        // Prefer exact author match
        const exactMatch = matches.find(
          (m) => m.author.toLowerCase() === rec.author.toLowerCase() && m.cover_url
        );
        if (exactMatch) {
          matchId = exactMatch.id;
        } else {
          // Take first match with a cover
          const withCover = matches.find((m) => m.cover_url);
          if (withCover) matchId = withCover.id;
        }
      }

      // Skip if not in our database or if it's the source book
      if (!matchId || matchId === book.id) continue;

      rows.push({
        book_id: book.id,
        recommended_book_id: matchId,
        reason: rec.reason,
        position: rows.length,
      });
    }

    if (rows.length === 0) {
      console.log(`[ai-recommendations] No DB matches for "${book.title}" recs`);
      return;
    }

    const { error } = await supabase
      .from("book_recommendations")
      .upsert(rows, { onConflict: "book_id,recommended_book_id" });

    if (error) {
      console.error(`[ai-recommendations] Failed to save recs for "${book.title}":`, error.message);
    } else {
      console.log(
        `[ai-recommendations] Saved ${rows.length} recs for "${book.title}" (${recs.length} suggested, ${recs.length - rows.length} not in DB)`
      );
    }
  } catch (err) {
    console.error(`[ai-recommendations] Failed for "${book.title}":`, err);
    throw err; // Let enrichment worker handle retry
  }
}
