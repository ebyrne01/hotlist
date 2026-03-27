import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  grabBooksFromVideo,
  getCachedGrab,
  type GrabStatus,
} from "@/lib/video";
import { getCorsHeaders, corsOptions, checkOrigin } from "@/lib/api/cors";

export function OPTIONS(req: Request) {
  return corsOptions(req.headers.get("origin"));
}

const bodySchema = z.object({
  url: z
    .string()
    .url()
    .refine(
      (url) => {
        const lower = url.toLowerCase();
        return (
          lower.includes("tiktok.com") ||
          lower.includes("instagram.com") ||
          lower.includes("youtube.com") ||
          lower.includes("youtu.be")
        );
      },
      { message: "URL must be a TikTok, Instagram, or YouTube link" }
    ),
  debug: z.boolean().optional(),
});

/**
 * POST /api/grab
 *
 * Streaming endpoint that processes a video URL and returns progress
 * updates followed by the final result.
 *
 * Stream format: newline-delimited JSON
 * Each line is: { "status": "downloading" } or { "result": {...} }
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = getCorsHeaders(origin);

  if (!checkOrigin(req)) {
    return Response.json(
      { error: "Unauthorized origin" },
      { status: 403, headers }
    );
  }

  let body: { url: string; debug?: boolean };
  try {
    const raw = await req.json();
    body = bodySchema.parse(raw);
  } catch {
    return Response.json(
      { error: "Invalid request. Please provide a valid TikTok, Instagram, or YouTube URL." },
      { status: 400, headers }
    );
  }

  const debug =
    req.nextUrl.searchParams.get("debug") === "true" || body.debug === true;

  // Check cache first (instant response, no streaming needed)
  const cached = await getCachedGrab(body.url);
  if (cached) {
    return NextResponse.json(cached, { headers });
  }

  // Stream progress updates
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function sendStatus(status: GrabStatus) {
        controller.enqueue(
          encoder.encode(JSON.stringify({ status }) + "\n")
        );
      }

      try {
        const result = await grabBooksFromVideo(
          body.url,
          sendStatus,
          undefined, // userId
          debug
        );
        if (debug && result.success && result.diagnostics) {
          controller.enqueue(
            encoder.encode(JSON.stringify({ diagnostics: result.diagnostics }) + "\n")
          );
        }
        controller.enqueue(
          encoder.encode(JSON.stringify({ result }) + "\n")
        );
      } catch (err) {
        console.error("[/api/grab] Unexpected error:", err);
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              result: {
                success: false,
                error: "video_unavailable",
              },
            }) + "\n"
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
      ...headers,
    },
  });
}
