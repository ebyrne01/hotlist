/**
 * Validate romance.io enrichment results.
 *
 * Reports on:
 * 1. Coverage: how many books have romance.io spice, tropes, ratings
 * 2. Tag distribution: top tags, uncategorized tags
 * 3. Spice comparison: romance.io vs other sources
 * 4. Trope overlap: romance.io vs llm_inference/scraped
 *
 * Usage: npx tsx scripts/romance-io-test/validate-romance-io.ts
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("=== Romance.io Enrichment Validation ===\n");

  // 1. Coverage
  const { data: totalBooks } = await supabase
    .from("books")
    .select("id", { count: "exact", head: true });

  const { data: withSlug } = await supabase
    .from("books")
    .select("id", { count: "exact", head: true })
    .not("romance_io_slug", "is", null);

  const { count: totalCount } = await supabase
    .from("books")
    .select("id", { count: "exact", head: true });

  const { count: slugCount } = await supabase
    .from("books")
    .select("id", { count: "exact", head: true })
    .not("romance_io_slug", "is", null);

  const { count: rioSpiceCount } = await supabase
    .from("spice_signals")
    .select("id", { count: "exact", head: true })
    .eq("source", "romance_io");

  const { count: rioRatingCount } = await supabase
    .from("book_ratings")
    .select("id", { count: "exact", head: true })
    .eq("source", "romance_io");

  const { count: rioTropeCount } = await supabase
    .from("book_tropes")
    .select("book_id", { count: "exact", head: true })
    .eq("source", "romance_io");

  const { data: rioBooksWithTropes } = await supabase
    .rpc("count_distinct_book_tropes_by_source", undefined)
    .select();

  // Manual distinct count for romance_io tropes
  const { data: distinctRioBooks } = await supabase
    .from("book_tropes")
    .select("book_id")
    .eq("source", "romance_io");
  const uniqueRioBookIds = new Set((distinctRioBooks ?? []).map((r) => r.book_id));

  console.log("COVERAGE:");
  console.log(`  Total books: ${totalCount}`);
  console.log(`  With romance.io slug: ${slugCount} (${((slugCount! / totalCount!) * 100).toFixed(1)}%)`);
  console.log(`  With romance.io spice signal: ${rioSpiceCount}`);
  console.log(`  With romance.io rating: ${rioRatingCount}`);
  console.log(`  With romance.io tropes: ${uniqueRioBookIds.size} books (${rioTropeCount} total book_trope rows)`);
  console.log();

  // 2. Trope distribution from romance.io
  const { data: tropeDistrib } = await supabase
    .from("book_tropes")
    .select("trope_id, tropes(name, slug)")
    .eq("source", "romance_io");

  if (tropeDistrib && tropeDistrib.length > 0) {
    const tropeCounts = new Map<string, number>();
    for (const row of tropeDistrib) {
      const trope = row.tropes as unknown as { name: string; slug: string } | null;
      const name = trope?.name || "unknown";
      tropeCounts.set(name, (tropeCounts.get(name) || 0) + 1);
    }
    const sorted = [...tropeCounts.entries()].sort((a, b) => b[1] - a[1]);

    console.log("TROPE DISTRIBUTION (from romance.io):");
    for (const [name, count] of sorted) {
      console.log(`  ${name}: ${count}`);
    }
    console.log();
  }

  // 3. Trope overlap: romance.io vs other sources
  const { data: allTropes } = await supabase
    .from("book_tropes")
    .select("book_id, trope_id, source");

  if (allTropes) {
    const rioTropes = new Set(
      allTropes.filter((t) => t.source === "romance_io").map((t) => `${t.book_id}:${t.trope_id}`)
    );
    const otherTropes = new Set(
      allTropes.filter((t) => t.source !== "romance_io").map((t) => `${t.book_id}:${t.trope_id}`)
    );

    let overlap = 0;
    let rioOnly = 0;
    for (const key of rioTropes) {
      if (otherTropes.has(key)) overlap++;
      else rioOnly++;
    }

    let otherOnly = 0;
    for (const key of otherTropes) {
      if (!rioTropes.has(key)) otherOnly++;
    }

    console.log("TROPE OVERLAP (romance.io vs llm_inference/scraped):");
    console.log(`  Romance.io trope assignments: ${rioTropes.size}`);
    console.log(`  Other source trope assignments: ${otherTropes.size}`);
    console.log(`  Overlap (same book+trope): ${overlap}`);
    console.log(`  Romance.io only (new data): ${rioOnly}`);
    console.log(`  Other sources only: ${otherOnly}`);
    console.log();
  }

  // 4. Spice comparison: romance.io vs other signals
  const { data: spiceSignals } = await supabase
    .from("spice_signals")
    .select("book_id, source, spice_value");

  if (spiceSignals) {
    const rioSpice = new Map<string, number>();
    const otherSpice = new Map<string, number[]>();

    for (const s of spiceSignals) {
      if (s.source === "romance_io") {
        rioSpice.set(s.book_id, s.spice_value);
      } else {
        if (!otherSpice.has(s.book_id)) otherSpice.set(s.book_id, []);
        otherSpice.get(s.book_id)!.push(s.spice_value);
      }
    }

    let agreements = 0;
    let disagreements = 0;
    let totalDiff = 0;
    let comparisons = 0;

    for (const [bookId, rioVal] of rioSpice) {
      const others = otherSpice.get(bookId);
      if (!others || others.length === 0) continue;
      const avgOther = others.reduce((a, b) => a + b, 0) / others.length;
      const diff = Math.abs(rioVal - avgOther);
      totalDiff += diff;
      comparisons++;
      if (diff <= 1) agreements++;
      else disagreements++;
    }

    console.log("SPICE COMPARISON (romance.io vs other signals):");
    console.log(`  Books with both rio + other spice: ${comparisons}`);
    console.log(`  Agree (within 1 level): ${agreements} (${comparisons > 0 ? ((agreements / comparisons) * 100).toFixed(1) : 0}%)`);
    console.log(`  Disagree (>1 level diff): ${disagreements}`);
    console.log(`  Average difference: ${comparisons > 0 ? (totalDiff / comparisons).toFixed(2) : "N/A"}`);
    console.log();
  }

  // 5. Spice level distribution from romance.io
  const { data: rioSpiceRows } = await supabase
    .from("spice_signals")
    .select("spice_value")
    .eq("source", "romance_io");

  if (rioSpiceRows) {
    const dist = new Map<number, number>();
    for (const r of rioSpiceRows) {
      dist.set(r.spice_value, (dist.get(r.spice_value) || 0) + 1);
    }
    console.log("SPICE LEVEL DISTRIBUTION (romance.io):");
    for (let i = 1; i <= 5; i++) {
      const count = dist.get(i) || 0;
      const bar = "█".repeat(Math.round(count / 10));
      console.log(`  Level ${i}: ${count} ${bar}`);
    }
    console.log();
  }

  console.log("DONE.");
}

main().catch(console.error);
