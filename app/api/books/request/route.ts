import { recordDiscoveryCandidate } from "@/lib/books/discovery-candidates";
import { resolveBookRequestCandidate } from "@/lib/books/user-request-resolver";
import {
  externalIdsFromUrl,
  providerFromUrl,
  titleHintFromUrl,
} from "@/lib/books/source-url";
import {
  checkRateLimit,
  rateLimitHeaders,
  rateLimitResponse,
} from "@/lib/api/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 60 * 60;

const requestSchema = z.object({
  title: z.string().trim().max(180).optional(),
  author: z.string().trim().max(120).optional(),
  sourceUrl: z.string().trim().url().max(600),
});

function cleanOptional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function POST(request: NextRequest) {
  const rateLimit = await checkRateLimit(request, {
    bucket: "book_request",
    limit: RATE_LIMIT,
    windowSeconds: RATE_WINDOW_SECONDS,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit, RATE_LIMIT);
  }

  try {
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Please include a valid book URL." },
        {
          status: 400,
          headers: rateLimitHeaders(rateLimit, RATE_LIMIT),
        }
      );
    }

    const sourceUrl = new URL(parsed.data.sourceUrl);
    if (!["http:", "https:"].includes(sourceUrl.protocol)) {
      return NextResponse.json(
        { error: "Please use a normal web URL." },
        {
          status: 400,
          headers: rateLimitHeaders(rateLimit, RATE_LIMIT),
        }
      );
    }

    const provider = providerFromUrl(sourceUrl);
    const titleHint = titleHintFromUrl(sourceUrl);
    const externalIds = externalIdsFromUrl(sourceUrl);
    const title = cleanOptional(parsed.data.title) ?? titleHint;
    const author = cleanOptional(parsed.data.author);

    if (!title) {
      return NextResponse.json(
        { error: "Please add the book title so we know what to look for." },
        {
          status: 400,
          headers: rateLimitHeaders(rateLimit, RATE_LIMIT),
        }
      );
    }

    const candidateId = await recordDiscoveryCandidate({
      title,
      author,
      source: "user_submitted_url",
      sourceUrl: sourceUrl.toString(),
      category: "reader_requested",
      demandScore: 120,
      metadata: {
        provider,
        submitted_title: cleanOptional(parsed.data.title),
        submitted_author: author,
        url_title_hint: titleHint,
        external_ids: externalIds,
      },
    });

    const resolution = candidateId
      ? await resolveBookRequestCandidate(candidateId)
      : null;

    return NextResponse.json(
      {
        ok: true,
        title,
        author,
        provider,
        resolution,
        message: "Book request captured.",
      },
      {
        headers: rateLimitHeaders(rateLimit, RATE_LIMIT),
      }
    );
  } catch (err) {
    console.error("[book-request] failed:", err);
    return NextResponse.json(
      { error: "Could not save that request. Please try again." },
      {
        status: 500,
        headers: rateLimitHeaders(rateLimit, RATE_LIMIT),
      }
    );
  }
}
