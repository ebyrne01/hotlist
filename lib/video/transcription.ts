/**
 * Audio Transcription via OpenAI Whisper API
 *
 * Whisper handles casual spoken content well — mumbling, background music,
 * fast speech, and non-standard pronunciation of book titles.
 *
 * Cost: ~$0.006 per minute of audio. A 3-minute BookTok video = ~$0.02.
 */

import OpenAI from "openai";

export interface TranscriptionResult {
  text: string;
  durationSeconds: number | null;
  language: string | null;
}

/**
 * Transcribe audio from a URL using OpenAI Whisper.
 * Returns null on failure — never throws.
 */
export async function transcribeAudio(
  audioOrVideoUrl: string
): Promise<TranscriptionResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[transcription] Missing OPENAI_API_KEY");
    return null;
  }

  try {
    // Fetch the audio file
    const response = await fetch(audioOrVideoUrl);
    if (!response.ok) {
      console.error(
        `[transcription] Failed to fetch audio: ${response.status}`
      );
      return null;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 25 * 1024 * 1024) {
      console.error("[transcription] Audio file too large (>25MB Whisper limit)");
      return null;
    }

    // Convert response to a File object for the OpenAI SDK
    const buffer = await response.arrayBuffer();
    const file = new File([buffer], "audio.mp4", { type: "audio/mp4" });

    const openai = new OpenAI({ apiKey });

    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file,
      response_format: "verbose_json",
    });

    return {
      text: transcription.text,
      durationSeconds: transcription.duration ?? null,
      language: transcription.language ?? null,
    };
  } catch (err) {
    console.error("[transcription] Failed:", err);
    return null;
  }
}
