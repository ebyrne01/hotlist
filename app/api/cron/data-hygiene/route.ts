import { NextResponse } from "next/server";
import { runDataHygiene } from "@/lib/books/data-hygiene";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDataHygiene();
    console.log(
      `[data-hygiene] Cleaned ${result.deleted} junk entries, migrated ${result.migrated} user refs, skipped ${result.skippedWithUserData.length}`
    );
    if (result.details.length > 0) {
      console.log(`[data-hygiene] Details:`, result.details.join("; "));
    }
    if (result.skippedWithUserData.length > 0) {
      console.log(
        `[data-hygiene] Skipped (has user data):`,
        result.skippedWithUserData.join("; ")
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/data-hygiene] Fatal error:", error);
    return NextResponse.json(
      { error: "Data hygiene failed" },
      { status: 500 }
    );
  }
}
