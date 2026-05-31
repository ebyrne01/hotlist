import { NextResponse } from "next/server";
import { requireCronAuth, cronUnauthorized } from "@/lib/api/cron-auth";
import { processBookRequestCandidates } from "@/lib/books/user-request-resolver";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  if (!requireCronAuth(request)) {
    return cronUnauthorized();
  }

  try {
    const result = await processBookRequestCandidates(20);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/book-request-resolver] Fatal error:", error);
    return NextResponse.json(
      { error: "Book request resolver failed" },
      { status: 500 }
    );
  }
}
