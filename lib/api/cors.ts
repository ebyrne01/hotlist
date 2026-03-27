import { NextResponse } from "next/server";

const PROD_ORIGIN = "https://myhotlist.app";

/**
 * Check if an origin is allowed for CORS.
 * Allows: our domain, Chrome extensions, and anything in dev.
 */
function isAllowedOrigin(origin: string | null): boolean {
  if (process.env.NODE_ENV === "development") return true;
  if (!origin) return false;
  if (origin === PROD_ORIGIN) return true;
  if (origin.startsWith("chrome-extension://")) return true;
  return false;
}

/** Build CORS headers for a given request origin. */
export function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowed = isAllowedOrigin(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? (origin || PROD_ORIGIN) : PROD_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

/**
 * Static CORS headers for contexts where request origin isn't available.
 * Prefer getCorsHeaders(origin) when you have access to the request.
 */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": PROD_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** JSON response with CORS headers */
export function corsJson(body: unknown, status = 200, origin?: string | null) {
  const headers = origin !== undefined ? getCorsHeaders(origin) : CORS_HEADERS;
  return NextResponse.json(body, { status, headers });
}

/** OPTIONS preflight response */
export function corsOptions(origin?: string | null) {
  const headers = origin !== undefined ? getCorsHeaders(origin) : CORS_HEADERS;
  return new Response(null, { status: 204, headers });
}

/**
 * Check if a request origin is allowed. Use this for origin-based
 * access control on write endpoints.
 */
export function checkOrigin(request: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const origin = request.headers.get("origin");
  return isAllowedOrigin(origin);
}
