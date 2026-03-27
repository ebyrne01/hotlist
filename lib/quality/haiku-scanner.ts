/**
 * HAIKU QUALITY SCANNER
 *
 * AI-powered semantic quality checks that catch issues the rules engine can't:
 * - Series names that pass regex but are semantically wrong
 * - Synopsis quality issues (placeholders, wrong-book summaries)
 * - Spice/genre mismatches (dark romance at spice 1, clean romance at spice 5)
 * - Goodreads ID mismatches (wrong edition resolved during enrichment)
 *
 * Each check sends a focused prompt to Haiku and gets structured JSON back.
 * Findings are written to the same quality_flags table as the rules engine.
 *
 * Cost: ~$0.002/book for all 4 checks. Hard daily cap via QUALITY_SCANNER_DAILY_LIMIT.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAdminClient } from "@/lib/supabase/admin";

export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
export const SONNET_MODEL = "claude-sonnet-4-6";
const DEFAULT_DAILY_LIMIT = 50;

// ── Types ─────────────────────────────────────────────

export interface ScannerResult {
  check: string;
  passed: boolean;
  confidence: number;
  issueType: string;
  fieldName: string;
  originalValue: string | null;
  suggestedValue: string | null;
  priority: "P0" | "P1" | "P2" | "P3";
  autoFixable: boolean;
  reasoning: string;
}

interface BookForScanner {
  id: string;
  title: string;
  author: string;
  series_name: string | null;
  series_position: string | null;
  ai_synopsis: string | null;
  description: string | null;
  genres: string[] | null;
  goodreads_id: string | null;
  goodreads_url: string | null;
  spice_level?: number | null;
  spice_source?: string | null;
  goodreads_scraped_title?: string | null;
  goodreads_scraped_author?: string | null;
}

// ── Daily limit guard ─────────────────────────────────

async function getDailyUsage(): Promise<number> {
  const supabase = getAdminClient();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("quality_flags")
    .select("*", { count: "exact", head: true })
    .eq("source", "haiku_scanner")
    .gte("created_at", todayStart.toISOString());

  return count ?? 0;
}

export async function isUnderDailyLimit(): Promise<boolean> {
  const limit = Number(process.env.QUALITY_SCANNER_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;
  const usage = await getDailyUsage();
  if (usage >= limit) {
    console.log(`[haiku-scanner] Daily limit reached (${usage}/${limit})`);
    return false;
  }
  return true;
}

// ── Haiku call helper ─────────────────────────────────

async function callModel(
  client: Anthropic,
  prompt: string,
  model?: string
): Promise<Record<string, unknown> | null> {
  try {
    const response = await client.messages.create({
      model: model ?? HAIKU_MODEL,
      max_tokens: 300,
      system:
        "You are a precise JSON-only responder for a romance book database quality system. Output only valid JSON, no markdown, no preamble.",
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text
      .replace(/```json?\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.warn(
      "[quality-scanner] Model call failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ── Check 1: Series Name Sanity ───────────────────────

export async function checkSeriesNameSanity(
  client: Anthropic,
  book: BookForScanner,
  model?: string
): Promise<ScannerResult | null> {
  if (!book.series_name) return null;

  // Same-author validation: if other books by this author share the series name,
  // it's almost certainly a real series — skip the LLM call entirely.
  const supabase = getAdminClient();
  const { count } = await supabase
    .from("books")
    .select("*", { count: "exact", head: true })
    .eq("author", book.author)
    .eq("series_name", book.series_name)
    .neq("id", book.id);

  if ((count ?? 0) >= 1) return null; // Other books confirm this series exists

  const result = await callModel(
    client,
    `Romance book database validator. Check if this series name is legitimate.

Book title: "${book.title}"
Book author: "${book.author}"
Series name field: "${book.series_name}"
${book.series_position ? `Series position: ${book.series_position}` : ""}

IMPORTANT: Many romance/romantasy series have creative names that may not obviously relate to the
book title. Do NOT flag a series name just because the connection to the title isn't obvious.

Only flag as invalid if the series name is clearly one of these problems:
- Edition info snuck into the field (e.g. "Large Print", "Kindle Edition", "2017 Collected Editions")
- A generic publisher bundle name (e.g. "Publisher's Weekly Picks")
- Completely garbled text or encoding artifacts
- A year or format descriptor rather than a series name

Examples (use these to calibrate your judgment):
- "Honey and Ice" for "A Court of Honey and Ash" by Shannon Mayer → VALID (thematic series name)
- "Married to Magic" for "A Deal with the Elf King" by Elise Kova → VALID (thematic series name)
- "Cruel Shifterverse" for "Psycho Beasts" by Jasmine Mas → VALID (creative series name)
- "The Bridge Kingdom" for "The Inadequate Heir" by Danielle L. Jensen → VALID (series setting)
- "Hades Saga" for "A Game of Gods" by Scarlett St. Clair → VALID (mythology-based series)
- "Blackstone Dynasty" for "Filthy Rich" by Raine Miller → VALID (family dynasty name)
- "Story Lake" for "Mistakes Were Made" by Lucy Score → VALID (setting-based series)
- "Echoes of the Void" for a fantasy romance → VALID (creative series name)
- "Runaways 2017 Collected Editions" for a comic → INVALID (edition artifact — "2017 Collected Editions" is format info)
- "Large Print Edition" for any book → INVALID (edition artifact)
- "Publisher's Classroom Library" for any book → INVALID (publisher collection)

When in doubt, mark as VALID. Romance series names are intentionally creative.

Respond with JSON only:
{
  "is_valid": true/false,
  "confidence": 0.0-1.0,
  "issue_type": "edition_artifact" | "publisher_collection" | "series_title_mismatch" | "garbled" | "valid",
  "suggested_fix": "corrected series name if obvious, or null to clear the field",
  "reasoning": "one sentence"
}`,
    model
  );

  if (!result) return null;
  if (Boolean(result.is_valid)) return null;

  const confidence = Number(result.confidence) || 0;
  if (confidence < 0.9) return null; // Raised from 0.7

  return {
    check: "series_name_sanity",
    passed: false,
    confidence,
    issueType: String(result.issue_type ?? "series_title_mismatch"),
    fieldName: "series_name",
    originalValue: book.series_name,
    suggestedValue:
      result.suggested_fix === "null"
        ? null
        : (result.suggested_fix as string | null),
    priority: "P1",
    autoFixable: false, // Never auto-fix series names — always human review
    reasoning: String(result.reasoning ?? ""),
  };
}

// ── Check 2: Synopsis Quality ─────────────────────────

export async function checkSynopsisQuality(
  client: Anthropic,
  book: BookForScanner,
  model?: string
): Promise<ScannerResult | null> {
  if (!book.ai_synopsis) return null;
  // Already caught by rules engine if under 60 chars
  if (book.ai_synopsis.trim().length < 60) return null;

  const result = await callModel(
    client,
    `Romance book database validator. Assess the quality of this synopsis.

Book: "${book.title}" by ${book.author}
Synopsis: "${book.ai_synopsis}"

Is this a genuine, useful synopsis for a romance reader?

IMPORTANT CALIBRATION — romance synopses naturally use trope-heavy language. These are GOOD:
- "When a brooding billionaire meets a headstrong woman..." → GOOD (specific character setup)
- "Sparks fly when enemies are forced to work together..." → GOOD (specific premise)
- A synopsis mentioning specific character names, settings, or plot points → GOOD
- A synopsis describing a specific trope setup (fake dating, enemies to lovers) → GOOD

Only flag these specific problems:
- "wrong_book": The synopsis is clearly about a COMPLETELY DIFFERENT book (e.g. a pharmacology
  textbook, a biography, a legal reference), OR the AI explicitly refused to write a synopsis
  (e.g. "I appreciate you sharing this, but this is a textbook...")
- "study_guide": Academic summary style ("In this book, the author explores themes of...")
- "no_story_detail": Synopsis contains zero specific story details — no character setup, no premise,
  no conflict. Just vague praise or marketing copy.
- "generic_filler": ONLY flag this if the synopsis could apply to literally ANY romance book with
  zero changes. If it mentions any specific detail (a setting, a character trait, a profession,
  a supernatural element), it is NOT generic filler.

CRITICAL — these are NOT wrong_book, do NOT flag:
- Fan fiction synopses that reference characters from another universe (e.g. Hermione, Draco from
  Harry Potter) — these are legitimate romance fan fiction entries in our database
- Books shelved as "young adult" or "thriller" that also have romance elements — our database
  includes romance-adjacent genres
- Synopses about fantasy, paranormal, or supernatural settings — these are romantasy books
- Horror/supernatural books with romantic elements — our database includes dark romance and paranormal

Examples (use these to calibrate — each shows the correct verdict):

GOOD synopses (do NOT flag):
- "Hermione returns to Hogwarts for her final year...discovers she's an Omega" (SenLinYu) → GOOD
  Fan fiction romance — HP characters are expected, this IS the right book
- "Draco Malfoy decides he's finally had enough of subtlety..." (SenLinYu) → GOOD
  Fan fiction romance referencing HP universe
- "A group of friends on magical ley lines...Ronan discovers he can pull things from dreams"
  (Maggie Stiefvater) → GOOD — YA fantasy/romantasy with specific plot details
- "When beloved podcast hosts disappear under mysterious circumstances" (thriller/romance) → GOOD
  Genre blend with specific story setup
- "When Holly lands her dream job as social media manager for the Vegas Crush" → GOOD
  Specific character, specific setting, specific premise — NOT generic
- "When the Rawlins family moves into the infamous Hindel Mansion in Louisiana" → GOOD
  Horror/paranormal with specific setting and characters (even if not core romance)
- "Erin Morgenstern whisks you away to two enchanting worlds" (compilation synopsis) → GOOD
  May be a combined entry — still tells the reader about the books

FLAG as wrong_book:
- "I appreciate you sharing this, but this is a nursing textbook..." → wrong_book
  AI explicitly refused to write a romance synopsis
- "I appreciate you sharing this, but this is a biography..." → wrong_book
  AI identified the book as non-fiction
- A biography like "Maggie Stiefvater" by Erin Staley (about an author's life) → wrong_book
  Non-fiction biography, not a novel

FLAG as no_story_detail:
- "I appreciate you sharing this title, but I'm unable to write an accurate synopsis since
  there's no available description..." → no_story_detail (AI had nothing to work with)

FLAG as study_guide:
- "In this novel, the author explores themes of identity and belonging..." → study_guide
  Academic analysis, not a reader-facing synopsis

FLAG as generic_filler:
- "Two people meet, sparks fly, and nothing will ever be the same." → generic_filler
  Could literally describe any romance ever written — zero specifics

When in doubt, mark as "good". We prefer to keep an imperfect synopsis over flagging a decent one.

Respond with JSON only:
{
  "quality": "good" | "generic_filler" | "wrong_book" | "study_guide" | "no_story_detail",
  "confidence": 0.0-1.0,
  "reasoning": "one sentence"
}`,
    model
  );

  if (!result) return null;
  if (result.quality === "good") return null;

  const confidence = Number(result.confidence) || 0;
  if (confidence < 0.90) return null; // Raised from 0.75

  return {
    check: "synopsis_quality",
    passed: false,
    confidence,
    issueType: String(result.quality),
    fieldName: "ai_synopsis",
    originalValue: book.ai_synopsis.substring(0, 200),
    suggestedValue: null,
    priority: "P2",
    autoFixable: false,
    reasoning: String(result.reasoning ?? ""),
  };
}

// ── Check 3: Spice/Genre Mismatch ────────────────────

export async function checkSpiceGenreMismatch(
  client: Anthropic,
  book: BookForScanner,
  model?: string
): Promise<ScannerResult | null> {
  if (book.spice_level == null) return null;
  if (!book.description && (!book.genres || book.genres.length === 0))
    return null;

  const result = await callModel(
    client,
    `Romance book database validator. Check if this spice level makes sense.

Book: "${book.title}" by ${book.author}
Genres: ${book.genres?.join(", ") || "unknown"}
Description: "${(book.description ?? "").substring(0, 400)}"
Current spice level: ${book.spice_level}/5 (source: ${book.spice_source ?? "unknown"})

Spice scale:
1 = Sweet/clean (no explicit content)
2 = Mild (some tension, fade to black)
3 = Moderate (love scenes present but tasteful)
4 = Steamy (explicit, detailed)
5 = Very explicit/erotica

Is this spice level plausible for this book given its genre and description?
Flag it if: dark romance shows spice 1-2, clean/inspirational romance shows spice 4-5,
erotica shows spice 1-2, or description strongly implies a different level than what's recorded.

IMPORTANT nuances — do NOT flag these as mismatches:
- Books tagged "young adult" AND "romance"/"romantasy" with spice 2-4: Many popular series
  (e.g. ACOTAR, Fourth Wing) are shelved as YA by some readers but contain significant
  romantic/sexual content. The "young adult" tag does not mean "clean."
- YA fantasy/paranormal with spice 1-2: This is plausible — mild romantic tension is common in YA.
- Sports romance tagged "young adult" (e.g. high school setting) with spice 2-3: Plausible.
- Only flag YA + spice as a mismatch for EXTREME cases: a book clearly written for children
  showing spice 4-5, or a book that is clearly erotica showing spice 1.

Examples (use these to calibrate):

PLAUSIBLE (do NOT flag):
- "A Court of Thorns and Roses" (fantasy, romance, young adult) at spice 3.5 → PLAUSIBLE
  ACOTAR is famously steamy despite YA shelving — this is a known pattern
- "The Raven King" (fantasy, young adult, paranormal, romance) at spice 2 → PLAUSIBLE
  YA with mild romantic tension is completely normal
- "Kiss Now, Lie Later" (sports romance, young adult, high school) at spice 2-3 → PLAUSIBLE
  New Adult / upper YA sports romance often has moderate heat
- "Barely Breathing" (young adult, romance, contemporary) at spice 3 → BORDERLINE
  Could go either way — only flag if clearly a middle-grade book
- "Lucky Puck" (sports romance, hockey) at spice 3-4 → PLAUSIBLE
  Adult sports romance typically runs moderate to steamy

FLAG as mismatch:
- "Dark Magick" by Cate Tiernan (YA witches/paranormal, Wicca series) at spice 3 → MISMATCH
  This is a middle-grade/early-YA series about teen witches, spice 3 is implausible
- A pharmacology textbook at any spice level → EXTREME mismatch (not a book at all)
- A children's picture book at spice 4 → EXTREME mismatch
- Erotica (genre: erotica, erotic romance) at spice 1 → SIGNIFICANT mismatch

Respond with JSON only:
{
  "is_plausible": true/false,
  "confidence": 0.0-1.0,
  "expected_range": "1-2" | "2-3" | "3-4" | "4-5" | "1-3" | "3-5",
  "mismatch_severity": "minor" | "significant" | "extreme",
  "reasoning": "one sentence"
}`,
    model
  );

  if (!result) return null;
  if (result.is_plausible) return null;

  const confidence = Number(result.confidence) || 0;
  if (confidence < 0.8) return null;

  // Only flag significant or extreme mismatches
  if (result.mismatch_severity === "minor") return null;

  const priority = result.mismatch_severity === "extreme" ? "P1" : "P2";

  return {
    check: "spice_genre_mismatch",
    passed: false,
    confidence,
    issueType: "spice_genre_mismatch",
    fieldName: "spice_signals",
    originalValue: `${book.spice_level}/5 (${book.spice_source})`,
    suggestedValue: null,
    priority,
    autoFixable: false,
    reasoning: String(result.reasoning ?? ""),
  };
}

// ── Check 4: Goodreads ID Mismatch ───────────────────

export async function checkGoodreadsIdMismatch(
  client: Anthropic,
  book: BookForScanner,
  model?: string
): Promise<ScannerResult | null> {
  if (!book.goodreads_id) return null;
  if (!book.goodreads_scraped_title && !book.goodreads_scraped_author)
    return null;

  const result = await callModel(
    client,
    `Romance book database validator. Check if a book was matched to the right Goodreads edition.

What we have in our database:
  Title: "${book.title}"
  Author: "${book.author}"

What Goodreads returned for ID ${book.goodreads_id}:
  Title: "${book.goodreads_scraped_title ?? "unknown"}"
  Author: "${book.goodreads_scraped_author ?? "unknown"}"

Are these the same book? Consider:
- Different editions of the same book (e.g. "Fourth Wing" vs "Fourth Wing (Special Edition)") = MATCH
- Foreign language editions (e.g. "Fourth Wing" vs "Alas de Cuarzo") = MISMATCH
- Clearly different books by the same author = MISMATCH
- Box set vs single book = MISMATCH
- Minor title variations or subtitle differences = MATCH
- Same book, slightly different author name format = MATCH
- Title with series info appended (e.g. "Burn" vs "Burn (Blood & Roses #3)") = MATCH

Examples:
- DB: "Fourth Wing" / GR: "Fourth Wing (Deluxe Edition)" → MATCH (same book, different edition)
- DB: "Twisted Love" / GR: "Twisted Love (Twisted, #1)" → MATCH (series info appended)
- DB: "A Court of Thorns and Roses" / GR: "Una Corte de Rosas y Espinas" → MISMATCH (foreign edition)
- DB: "Fourth Wing" / GR: "Iron Flame" → MISMATCH (different book, same series/author)
- DB: "Burn" by Callie Hart / GR: "Burn: The Complete Series" → MISMATCH (single vs box set)
- DB: "Sarah J. Maas" / GR: "Sarah Janet Maas" → MATCH (name format variation)

Respond with JSON only:
{
  "is_match": true/false,
  "confidence": 0.0-1.0,
  "mismatch_type": "foreign_edition" | "wrong_book" | "box_set_vs_single" | "wrong_author" | "match",
  "reasoning": "one sentence"
}`,
    model
  );

  if (!result) return null;
  if (result.is_match) return null;

  const confidence = Number(result.confidence) || 0;
  if (confidence < 0.8) return null;

  return {
    check: "goodreads_id_mismatch",
    passed: false,
    confidence,
    issueType: `goodreads_${String(result.mismatch_type ?? "wrong_book")}`,
    fieldName: "goodreads_id",
    originalValue: `goodreads_id: ${book.goodreads_id} → scraped as "${book.goodreads_scraped_title}" by ${book.goodreads_scraped_author}`,
    suggestedValue: null,
    priority: "P0",
    autoFixable: false,
    reasoning: String(result.reasoning ?? ""),
  };
}

// ── Main scan function ────────────────────────────────

/**
 * Run all four checks on a single book and persist findings.
 * Pass `model` to override the default (Haiku) — used for comparison tests.
 * Pass `dryRun: true` to return findings without persisting (for comparison).
 */
export async function scanBook(
  client: Anthropic,
  bookId: string,
  opts?: { model?: string; dryRun?: boolean }
): Promise<{ checked: number; flagged: number; findings?: ScannerResult[] }> {
  const supabase = getAdminClient();

  const { data: bookRow } = await supabase
    .from("books")
    .select(
      "id, title, author, series_name, series_position, ai_synopsis, description, genres, goodreads_id, goodreads_url"
    )
    .eq("id", bookId)
    .single();

  if (!bookRow) return { checked: 0, flagged: 0 };

  // Fetch best available spice signal
  const { data: spiceRow } = await supabase
    .from("spice_signals")
    .select("spice_value, source, confidence")
    .eq("book_id", bookId)
    .order("confidence", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fetch Goodreads-scraped title/author from enrichment evidence
  const { data: grEvidence } = await supabase
    .from("enrichment_queue")
    .select("evidence")
    .eq("book_id", bookId)
    .eq("job_type", "goodreads_detail")
    .eq("status", "completed")
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const evidence = grEvidence?.evidence as Record<string, unknown> | null;
  const grScrapedTitle = (evidence?.scraped_title as string) ?? null;
  const grScrapedAuthor = (evidence?.scraped_author as string) ?? null;

  const book: BookForScanner = {
    id: bookRow.id,
    title: bookRow.title,
    author: bookRow.author,
    series_name: bookRow.series_name,
    series_position: bookRow.series_position
      ? String(bookRow.series_position)
      : null,
    ai_synopsis: bookRow.ai_synopsis,
    description: bookRow.description,
    genres: bookRow.genres ?? [],
    goodreads_id: bookRow.goodreads_id,
    goodreads_url: bookRow.goodreads_url,
    spice_level: spiceRow?.spice_value ?? null,
    spice_source: spiceRow?.source ?? null,
    goodreads_scraped_title: grScrapedTitle,
    goodreads_scraped_author: grScrapedAuthor,
  };

  const model = opts?.model;

  // Run all four checks in parallel
  const results = await Promise.allSettled([
    checkSeriesNameSanity(client, book, model),
    checkSynopsisQuality(client, book, model),
    checkSpiceGenreMismatch(client, book, model),
    checkGoodreadsIdMismatch(client, book, model),
  ]);

  const findings = results
    .filter(
      (r): r is PromiseFulfilledResult<ScannerResult | null> =>
        r.status === "fulfilled"
    )
    .map((r) => r.value)
    .filter((r): r is ScannerResult => r !== null);

  if (findings.length === 0) {
    return { checked: 4, flagged: 0, ...(opts?.dryRun ? { findings: [] } : {}) };
  }

  // In dry-run mode, return findings without persisting
  if (opts?.dryRun) {
    return { checked: 4, flagged: findings.length, findings };
  }

  // Persist findings
  for (const finding of findings) {
    const { error } = await supabase.from("quality_flags").insert({
      book_id: bookId,
      field_name: finding.fieldName,
      issue_type: finding.issueType,
      source: "haiku_scanner",
      confidence: finding.confidence,
      original_value: finding.originalValue,
      suggested_value: finding.suggestedValue,
      priority: finding.priority,
      auto_fixable: finding.autoFixable,
      status: "open",
    });

    // 23505 = unique_violation — flag already exists, skip
    if (error && error.code !== "23505") {
      console.warn("[haiku-scanner] Insert error:", error.message);
    }

    // Auto-fix high-confidence auto-fixable findings immediately
    if (finding.autoFixable && finding.confidence >= 0.92) {
      await applyAutoFix(bookId, finding);
    }

    // Auto-demote from canon when scanner finds wrong_book or goodreads_wrong_book
    if (
      (finding.issueType === "wrong_book" || finding.issueType === "goodreads_wrong_book") &&
      finding.confidence >= 0.9
    ) {
      const { demoteFromCanon } = await import("@/lib/books/canon-gate");
      await demoteFromCanon(bookId, `haiku_scanner: ${finding.issueType} (confidence: ${finding.confidence})`);
    }
  }

  return { checked: 4, flagged: findings.length };
}

// ── Auto-fix ──────────────────────────────────────────

async function applyAutoFix(bookId: string, finding: ScannerResult) {
  const supabase = getAdminClient();

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  update[finding.fieldName] = finding.suggestedValue ?? null;

  const { error } = await supabase
    .from("books")
    .update(update)
    .eq("id", bookId);

  if (!error) {
    await supabase
      .from("quality_flags")
      .update({
        status: "auto_fixed",
        resolved_at: new Date().toISOString(),
        resolved_by: "auto",
        resolution_note: `Auto-fixed by Haiku scanner (confidence: ${finding.confidence})`,
      })
      .eq("book_id", bookId)
      .eq("field_name", finding.fieldName)
      .eq("issue_type", finding.issueType)
      .eq("status", "open");

    console.log(
      `[haiku-scanner] Auto-fixed ${finding.fieldName} for book ${bookId}: "${finding.originalValue}" → ${finding.suggestedValue ?? "null"}`
    );
  }
}
