import { NextResponse } from "next/server";

/**
 * Verify cron job authentication.
 * Allows all requests in development; requires Bearer CRON_SECRET in production.
 */
export function requireCronAuth(request: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

/** Standard 401 response for failed cron auth. */
export function cronUnauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
