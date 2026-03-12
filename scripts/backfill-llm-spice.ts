/**
 * BACKFILL LLM SPICE INFERENCE
 *
 * Runs Claude Haiku spice inference on books that have a description but
 * lack higher-confidence spice signals (community, romance_io, review_classifier).
 * Prioritizes books with the most hotlist appearances (most user value).
 *
 * Respects a daily limit (default 100, override with SPICE_LLM_DAILY_LIMIT).
 * Processes in batches of 10 with 1-second delays.
 *
 * Usage: npx tsx scripts/backfill-llm-spice.ts
 *        npx tsx scripts/backfill-llm-spice.ts --limit 50
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { inferSpiceFromDescription } from "../lib/spice/llm-inference";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1000;
const HIGHER_CONFIDENCE_SOURCES = ["community", "romance_io", "review_classifier"];

async function main() {
  const supabase = getAdminClient();

  // Parse --limit flag
  const limitFlagIndex = process.argv.indexOf("--limit");
  const dailyLimit =
    limitFlagIndex !== -1 && process.argv[limitFlagIndex + 1]
      ? Number(process.argv[limitFlagIndex + 1])
      : Number(process.env.SPICE_LLM_DAILY_LIMIT) || 100;

  console.log(`LLM spice backfill — limit: ${dailyLimit}`);

  // Check how many we've already done today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count: todayCount } = await supabase
    .from("spice_signals")
    .select("*", { count: "exact", head: true })
    .eq("source", "llm_inference")
    .gte("updated_at", todayStart.toISOString());

  const alreadyDone = todayCount ?? 0;
  const remaining = dailyLimit - alreadyDone;
  console.log(`Already inferred today: ${alreadyDone}, remaining budget: ${remaining}`);

  if (remaining <= 0) {
    console.log("Daily limit already reached. Exiting.");
    return;
  }

  // Get book IDs that already have higher-confidence signals
  const { data: highConfRows } = await supabase
    .from("spice_signals")
    .select("book_id")
    .in("source", HIGHER_CONFIDENCE_SOURCES);
  const highConfBookIds = new Set((highConfRows ?? []).map((r) => r.book_id));
  console.log(`Books with higher-confidence signals (skip): ${highConfBookIds.size}`);

  // Get book IDs that already have LLM inference
  const { data: existingLlm } = await supabase
    .from("spice_signals")
    .select("book_id")
    .eq("source", "llm_inference");
  const existingLlmIds = new Set((existingLlm ?? []).map((r) => r.book_id));
  console.log(`Books already with LLM inference (skip): ${existingLlmIds.size}`);

  // Fetch candidate books: have description, ordered by hotlist appearances (most popular first)
  // We use a raw query to count hotlist appearances for prioritization
  const { data: candidates, error } = await supabase
    .from("books")
    .select("id, title, author, description, genres")
    .not("description", "is", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching books:", error.message);
    return;
  }

  if (!candidates || candidates.length === 0) {
    console.log("No candidate books found.");
    return;
  }

  // Filter to eligible books
  const eligible = candidates.filter((b) => {
    if (!b.description || b.description.length < 50) return false;
    if (highConfBookIds.has(b.id)) return false;
    if (existingLlmIds.has(b.id)) return false;
    return true;
  });

  console.log(`Eligible books for inference: ${eligible.length}`);

  // Try to prioritize by hotlist appearances
  const { data: hotlistCounts } = await supabase
    .from("hotlist_books")
    .select("book_id");

  const appearanceCount = new Map<string, number>();
  if (hotlistCounts) {
    for (const row of hotlistCounts) {
      appearanceCount.set(row.book_id, (appearanceCount.get(row.book_id) ?? 0) + 1);
    }
  }

  // Sort: most hotlist appearances first, then by creation date
  eligible.sort((a, b) => {
    const aCount = appearanceCount.get(a.id) ?? 0;
    const bCount = appearanceCount.get(b.id) ?? 0;
    return bCount - aCount;
  });

  const toProcess = eligible.slice(0, remaining);
  console.log(`Processing ${toProcess.length} books...\n`);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);

    for (const book of batch) {
      processed++;
      try {
        const result = await inferSpiceFromDescription({
          title: book.title,
          author: book.author,
          description: book.description!,
          genres: book.genres ?? [],
        });

        if (result) {
          await supabase.from("spice_signals").upsert(
            {
              book_id: book.id,
              source: "llm_inference",
              spice_value: result.spice,
              confidence: result.confidence,
              evidence: {
                reasoning: result.reasoning,
                model: "claude-haiku-4-5-20251001",
                description_length: book.description!.length,
                inferred_at: new Date().toISOString(),
              },
              updated_at: new Date().toISOString(),
            },
            { onConflict: "book_id,source" }
          );
          succeeded++;
        } else {
          failed++;
        }
      } catch (err) {
        console.error(
          `  Error for "${book.title}":`,
          err instanceof Error ? err.message : err
        );
        failed++;
      }
    }

    // Delay between batches
    if (i + BATCH_SIZE < toProcess.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log(`\nDone!`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Succeeded: ${succeeded}`);
  console.log(`  Failed: ${failed}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
