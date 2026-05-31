import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

interface RateLimitOptions {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

const fallbackCounters = new Map<
  string,
  { count: number; resetAt: number }
>();

function getClientIdentifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    forwarded?.split(",")[0]?.trim() ??
    "unknown";

  const userAgent = request.headers.get("user-agent") ?? "unknown";
  return `${ip}:${userAgent}`;
}

function hashIdentifier(identifier: string): string {
  return createHash("sha256").update(identifier).digest("hex");
}

function fallbackRateLimit(
  identifierHash: string,
  options: RateLimitOptions
): RateLimitResult {
  const key = `${options.bucket}:${identifierHash}`;
  const now = Date.now();
  const windowMs = options.windowSeconds * 1000;
  const current = fallbackCounters.get(key);

  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs;
    fallbackCounters.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: Math.max(options.limit - 1, 0),
      resetAt: new Date(resetAt),
    };
  }

  current.count += 1;
  fallbackCounters.set(key, current);

  return {
    allowed: current.count <= options.limit,
    remaining: Math.max(options.limit - current.count, 0),
    resetAt: new Date(current.resetAt),
  };
}

export async function checkRateLimit(
  request: Request,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const identifierHash = hashIdentifier(getClientIdentifier(request));
  const supabase = getAdminClient();

  const { data, error } = await supabase.rpc("check_api_rate_limit", {
    p_bucket: options.bucket,
    p_identifier_hash: identifierHash,
    p_limit: options.limit,
    p_window_seconds: options.windowSeconds,
  });

  const row = Array.isArray(data) ? data[0] : null;
  if (!error && row) {
    return {
      allowed: Boolean(row.allowed),
      remaining: Number(row.remaining ?? 0),
      resetAt: new Date(row.reset_at),
    };
  }

  console.warn(
    `[rate-limit] Falling back to in-memory limiter for ${options.bucket}: ${error?.message ?? "missing result"}`
  );
  return fallbackRateLimit(identifierHash, options);
}

export function rateLimitHeaders(
  result: RateLimitResult,
  limit: number
): Record<string, string> {
  return {
    "RateLimit-Limit": String(limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil(result.resetAt.getTime() / 1000)),
  };
}

export function rateLimitResponse(
  result: RateLimitResult,
  limit: number,
  extraHeaders?: HeadersInit
) {
  return NextResponse.json(
    { error: "Too many requests. Try again later." },
    {
      status: 429,
      headers: {
        ...rateLimitHeaders(result, limit),
        "Retry-After": String(
          Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000))
        ),
        ...(extraHeaders as Record<string, string> | undefined),
      },
    }
  );
}
