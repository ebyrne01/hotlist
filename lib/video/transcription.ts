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
  audioOrVideoUrl: string,
  signal?: AbortSignal
): Promise<TranscriptionResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[transcription] Missing OPENAI_API_KEY");
    return null;
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), 30_000);
  const abortFromParent = () => timeoutController.abort();
  signal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    // Fetch the audio file with a hard timeout and streaming byte cap.
    const response = await fetch(audioOrVideoUrl, {
      signal: timeoutController.signal,
    });

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

    const buffer = await readResponseWithLimit(response, 25 * 1024 * 1024);
    if (!buffer) return null;

    // Convert response to a File object for the OpenAI SDK
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
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

async function readResponseWithLimit(
  response: Response,
  maxBytes: number
): Promise<ArrayBuffer | null> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      console.error("[transcription] Audio file too large (>25MB Whisper limit)");
      return null;
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      console.error("[transcription] Audio file too large (>25MB Whisper limit)");
      return null;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged.buffer;
}
