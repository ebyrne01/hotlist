/**
 * TRANSCRIPT PREPROCESSOR
 *
 * Runs before the Sonnet book agent to:
 * 1. Apply known Whisper error corrections to the raw transcript
 * 2. Detect if the video is about series/trilogy recommendations
 * 3. If so, extract series names via a fast Haiku call
 *
 * This shifts error correction and series detection to deterministic
 * pre-processing + a cheap Haiku call (~$0.001), giving the Sonnet
 * agent a much simpler job with an explicit checklist.
 */

import Anthropic from "@anthropic-ai/sdk";

/**
 * Known Whisper transcription errors.
 * Keys are case-insensitive patterns, values are corrections.
 * Applied as simple string replacements on the transcript.
 */
const WHISPER_CORRECTIONS: [RegExp, string][] = [
  // Author name corrections
  [/\bSara J\.? Mass?\b/gi, "Sarah J. Maas"],
  [/\bSarah J\.? Moss\b/gi, "Sarah J. Maas"],
  [/\bRebecca Yarrows?\b/gi, "Rebecca Yarros"],
  [/\bRebecca Yarrose\b/gi, "Rebecca Yarros"],
  [/\bRebecca Yaros\b/gi, "Rebecca Yarros"],
  [/\bAnna Wong\b/gi, "Ana Huang"],
  [/\bAna Wong\b/gi, "Ana Huang"],
  [/\bHD Carlton\b/gi, "H.D. Carlton"],
  [/\bKayleen Hoover\b/gi, "Colleen Hoover"],
  [/\bColleen Hover\b/gi, "Colleen Hoover"],
  [/\bKristen Hanna\b/gi, "Kristin Hannah"],
  [/\bMcKaylee Smeltzer\b/gi, "Micalea Smeltzer"],
  [/\bMicalee Smeltzer\b/gi, "Micalea Smeltzer"],
  [/\bRachel Gillick\b/gi, "Rachel Gillig"],
  [/\bRachel Gillik\b/gi, "Rachel Gillig"],
  [/\bKristen Cicirelli\b/gi, "Kristen Ciccarelli"],
  [/\bKristen Chiccarelli\b/gi, "Kristen Ciccarelli"],
  [/\bCynlyn Yu\b/gi, "SenLinYu"],
  [/\bSinlin Yu\b/gi, "SenLinYu"],
  [/\bDebney Perry\b/gi, "Devney Perry"],
  [/\bKatie Rogan\b/gi, "Katy Rogan"],

  // Title/series corrections
  [/\bAshes of Thesmar\b/gi, "Ashes of Thezmarr"],
  [/\bLegends of Thesmar\b/gi, "Legends of Thezmarr"],
  [/\bThesmar\b/gi, "Thezmarr"],
  [/\bOn a Storm\b/gi, "Onyx Storm"],
  [/\bOnyx Store\b/gi, "Onyx Storm"],
  [/\bIron Frame\b/gi, "Iron Flame"],
  [/\bThe Night in the Moth\b/gi, "The Knight and the Moth"],
  [/\bRose and Chains\b/gi, "Rose in Chains"],
  [/\bInfantness of Yesterday\b/gi, "The Infiniteness of Yesterday"],
  [/\bflame curse fae\b/gi, "Flame Cursed Fae"],
  [/\bPower of Hayes\b/gi, "Power of Hades"],
];

/** Series/trilogy detection keywords */
const SERIES_KEYWORDS = /\b(trilogi|trilogies|completed series|series rec|best series|favorite series|complete series|series you need|three books?)\b/i;

export interface PreprocessedTranscript {
  /** Corrected transcript text */
  correctedText: string;
  /** Whether this appears to be a series/trilogy recommendation video */
  isSeriesVideo: boolean;
  /** Extracted series names + authors (from Haiku) — empty if not a series video */
  seriesHints: SeriesHint[];
}

export interface SeriesHint {
  seriesName: string;
  author: string;
  bookCount?: number;
}

/**
 * Apply known Whisper corrections to the transcript.
 */
export function correctTranscript(raw: string): string {
  let text = raw;
  for (const [pattern, replacement] of WHISPER_CORRECTIONS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

/**
 * Check if the transcript is about series/trilogy recommendations.
 */
export function detectSeriesMode(transcript: string): boolean {
  return SERIES_KEYWORDS.test(transcript);
}

/**
 * Extract series names and authors from a transcript using Haiku.
 * Fast (~1-2s) and cheap (~$0.001).
 */
async function extractSeriesWithHaiku(transcript: string): Promise<SeriesHint[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      temperature: 0,
      system: "You extract book series information from BookTok video transcripts. Return ONLY valid JSON, no other text.",
      messages: [
        {
          role: "user",
          content: `Extract every book series or trilogy mentioned in this BookTok transcript. For each, provide the series name and author if mentioned. Return a JSON array of objects with "seriesName", "author", and optionally "bookCount".

IMPORTANT:
- Extract the SERIES NAME, not individual book titles. E.g. "Flame Cursed Fae" not "Of Blades and Wings"
- If the creator mentions a book title as part of a series, use the series name
- If an author isn't explicitly named, use "" for author
- Only extract series the creator is actually recommending, not passing references ("like Throne of Glass" is a comparison, not a recommendation — unless they're recommending it directly)

TRANSCRIPT:
${transcript.slice(0, 3000)}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return [];

    // Parse JSON from response — handle markdown code blocks
    let jsonStr = textBlock.text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((s: Record<string, unknown>) => s.seriesName && typeof s.seriesName === "string")
      .map((s: Record<string, unknown>) => ({
        seriesName: s.seriesName as string,
        author: (s.author as string) || "",
        bookCount: typeof s.bookCount === "number" ? s.bookCount : undefined,
      }));
  } catch (err) {
    console.warn("[transcript-preprocessor] Haiku series extraction failed:", err);
    return [];
  }
}

/**
 * Full preprocessing pipeline:
 * 1. Apply Whisper corrections
 * 2. Detect series mode
 * 3. If series mode, extract series names with Haiku
 */
export async function preprocessTranscript(rawTranscript: string): Promise<PreprocessedTranscript> {
  const correctedText = correctTranscript(rawTranscript);
  const isSeriesVideo = detectSeriesMode(correctedText);

  let seriesHints: SeriesHint[] = [];
  if (isSeriesVideo) {
    console.log("[transcript-preprocessor] Series video detected, extracting series names with Haiku...");
    seriesHints = await extractSeriesWithHaiku(correctedText);
    console.log(`[transcript-preprocessor] Extracted ${seriesHints.length} series:`, seriesHints.map((s) => `${s.seriesName} by ${s.author}`).join(", "));
  }

  return { correctedText, isSeriesVideo, seriesHints };
}
