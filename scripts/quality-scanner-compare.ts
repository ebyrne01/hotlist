/**
 * QUALITY SCANNER MODEL COMPARISON
 *
 * Runs both Haiku (tuned) and Sonnet on the same set of books in dry-run mode
 * (no DB writes) and outputs a side-by-side comparison to help decide if
 * Sonnet is worth the cost for the full backfill sweep.
 *
 * Usage:
 *   npx tsx scripts/quality-scanner-compare.ts              # 20 books (default)
 *   npx tsx scripts/quality-scanner-compare.ts --limit 50   # 50 books
 *   npx tsx scripts/quality-scanner-compare.ts --flagged    # only books Haiku previously flagged
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { scanBook, HAIKU_MODEL, SONNET_MODEL } from "../lib/quality/haiku-scanner";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anthropicKey = process.env.ANTHROPIC_API_KEY!;

if (!supabaseUrl || !supabaseKey || !anthropicKey) {
  console.error("Missing required env vars");
  process.exit(1);
}

interface ComparisonRow {
  bookTitle: string;
  bookAuthor: string;
  haikuFlags: string[];
  sonnetFlags: string[];
  agreement: "both_clean" | "both_flagged" | "haiku_only" | "sonnet_only" | "different_flags";
}

async function main() {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const client = new Anthropic({ apiKey: anthropicKey });

  const args = process.argv.slice(2);
  const flaggedOnly = args.includes("--flagged");
  const limitArg =
    args.find((a) => a.startsWith("--limit="))?.split("=")[1] ??
    args[args.indexOf("--limit") + 1];
  const limit = limitArg ? Number(limitArg) : 20;

  console.log("Quality Scanner — Haiku vs Sonnet Comparison");
  console.log("=============================================");
  console.log(`Model A: ${HAIKU_MODEL} (tuned prompts)`);
  console.log(`Model B: ${SONNET_MODEL}`);
  console.log(`Mode: ${flaggedOnly ? "previously-flagged books" : "random complete books"}`);
  console.log(`Sample size: ${limit}\n`);

  let bookIds: string[];

  if (flaggedOnly) {
    // Pick books that Haiku previously flagged (good for checking false positives)
    const { data } = await supabase
      .from("quality_flags")
      .select("book_id")
      .eq("source", "haiku_scanner")
      .eq("status", "open")
      .limit(limit * 2);

    const unique = [...new Set((data ?? []).map((r) => r.book_id))];
    bookIds = unique.slice(0, limit);
  } else {
    // Pick random complete books (good for checking false negatives)
    const { data } = await supabase
      .from("books")
      .select("id")
      .eq("enrichment_status", "complete")
      .order("updated_at", { ascending: false })
      .limit(limit);

    bookIds = (data ?? []).map((r) => r.id);
  }

  console.log(`Found ${bookIds.length} books to compare\n`);

  const results: ComparisonRow[] = [];
  let haikuTotalFlags = 0;
  let sonnetTotalFlags = 0;

  for (let i = 0; i < bookIds.length; i++) {
    const bookId = bookIds[i];

    // Get book info for display
    const { data: book } = await supabase
      .from("books")
      .select("title, author")
      .eq("id", bookId)
      .single();

    const label = `${(book?.title ?? "Unknown").substring(0, 40)}`.padEnd(42);
    process.stdout.write(`[${i + 1}/${bookIds.length}] ${label}`);

    // Run both models in dry-run mode
    const [haikuResult, sonnetResult] = await Promise.all([
      scanBook(client, bookId, { model: HAIKU_MODEL, dryRun: true }),
      scanBook(client, bookId, { model: SONNET_MODEL, dryRun: true }),
    ]);

    const haikuFlags = (haikuResult.findings ?? []).map(
      (f) => `${f.check}:${f.issueType}(${f.confidence})`
    );
    const sonnetFlags = (sonnetResult.findings ?? []).map(
      (f) => `${f.check}:${f.issueType}(${f.confidence})`
    );

    haikuTotalFlags += haikuFlags.length;
    sonnetTotalFlags += sonnetFlags.length;

    // Determine agreement
    let agreement: ComparisonRow["agreement"];
    if (haikuFlags.length === 0 && sonnetFlags.length === 0) {
      agreement = "both_clean";
    } else if (haikuFlags.length > 0 && sonnetFlags.length > 0) {
      const haikuChecks = new Set(haikuFlags.map((f) => f.split("(")[0]));
      const sonnetChecks = new Set(sonnetFlags.map((f) => f.split("(")[0]));
      const overlap = [...haikuChecks].some((c) => sonnetChecks.has(c));
      agreement = overlap ? "both_flagged" : "different_flags";
    } else if (haikuFlags.length > 0) {
      agreement = "haiku_only";
    } else {
      agreement = "sonnet_only";
    }

    const icon =
      agreement === "both_clean" ? "✓" :
      agreement === "both_flagged" ? "⚑" :
      agreement === "haiku_only" ? "H" :
      agreement === "sonnet_only" ? "S" :
      "≠";

    process.stdout.write(` ${icon}`);
    if (haikuFlags.length > 0 || sonnetFlags.length > 0) {
      process.stdout.write(
        `  H:[${haikuFlags.join(", ") || "clean"}]  S:[${sonnetFlags.join(", ") || "clean"}]`
      );
    }
    process.stdout.write("\n");

    results.push({
      bookTitle: book?.title ?? "Unknown",
      bookAuthor: book?.author ?? "Unknown",
      haikuFlags,
      sonnetFlags,
      agreement,
    });

    // Small delay to avoid rate limits
    await new Promise((r) => setTimeout(r, 500));
  }

  // Summary
  console.log("\n=============================================");
  console.log("SUMMARY");
  console.log("=============================================");

  const counts = {
    both_clean: results.filter((r) => r.agreement === "both_clean").length,
    both_flagged: results.filter((r) => r.agreement === "both_flagged").length,
    haiku_only: results.filter((r) => r.agreement === "haiku_only").length,
    sonnet_only: results.filter((r) => r.agreement === "sonnet_only").length,
    different_flags: results.filter((r) => r.agreement === "different_flags").length,
  };

  console.log(`\nTotal books compared: ${results.length}`);
  console.log(`Haiku total flags: ${haikuTotalFlags}`);
  console.log(`Sonnet total flags: ${sonnetTotalFlags}`);
  console.log(`\nAgreement breakdown:`);
  console.log(`  Both clean (agree no issues):  ${counts.both_clean}`);
  console.log(`  Both flagged (agree on issue): ${counts.both_flagged}`);
  console.log(`  Haiku only (potential FP):     ${counts.haiku_only}`);
  console.log(`  Sonnet only (Haiku missed):    ${counts.sonnet_only}`);
  console.log(`  Different flags:               ${counts.different_flags}`);

  const agreementRate =
    ((counts.both_clean + counts.both_flagged) / results.length) * 100;
  console.log(`\nAgreement rate: ${agreementRate.toFixed(1)}%`);

  // Show disagreements in detail
  const disagreements = results.filter(
    (r) => r.agreement === "haiku_only" || r.agreement === "sonnet_only" || r.agreement === "different_flags"
  );

  if (disagreements.length > 0) {
    console.log(`\n── Disagreements (${disagreements.length}) ──`);
    for (const d of disagreements) {
      console.log(`\n  "${d.bookTitle}" by ${d.bookAuthor}`);
      console.log(`    Haiku:  ${d.haikuFlags.join(", ") || "(clean)"}`);
      console.log(`    Sonnet: ${d.sonnetFlags.join(", ") || "(clean)"}`);
    }
  }

  console.log(`\nFinished: ${new Date().toLocaleString()}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
