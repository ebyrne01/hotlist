/**
 * TRANSCRIPT PREPROCESSOR
 *
 * Runs before the two-phase book agent to:
 * 1. Apply known Whisper error corrections to the raw transcript
 * 2. Detect if the video is about series/trilogy recommendations
 *
 * Series extraction is now handled by Phase 1 (Haiku observation),
 * so this module only does deterministic preprocessing.
 */

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
 * Full preprocessing pipeline:
 * 1. Apply Whisper corrections
 * 2. Detect series mode
 */
export function preprocessTranscript(rawTranscript: string): PreprocessedTranscript {
  const correctedText = correctTranscript(rawTranscript);
  const isSeriesVideo = detectSeriesMode(correctedText);

  if (isSeriesVideo) {
    console.log("[transcript-preprocessor] Series video detected");
  }

  return { correctedText, isSeriesVideo };
}
