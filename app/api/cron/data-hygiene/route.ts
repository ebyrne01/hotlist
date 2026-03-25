import { NextResponse } from "next/server";
import { runDataHygiene } from "@/lib/books/data-hygiene";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Data hygiene cron — junk removal, dedup, user ref migration.
 * Runs Sundays 2 AM UTC. Quality pipeline runs separately at 3 AM.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const hygiene = await runDataHygiene();
    console.log(
      `[data-hygiene] Cleaned ${hygiene.deleted} junk entries, migrated ${hygiene.migrated} user refs, skipped ${hygiene.skippedWithUserData.length}`
    );
    if (hygiene.details.length > 0) {
      console.log(`[data-hygiene] Details:`, hygiene.details.join("; "));
    }
    if (hygiene.skippedWithUserData.length > 0) {
      console.log(
        `[data-hygiene] Skipped (has user data):`,
        hygiene.skippedWithUserData.join("; ")
      );
    }

    return NextResponse.json({ hygiene });
  } catch (error) {
    console.error("[cron/data-hygiene] Fatal error:", error);
    return NextResponse.json(
      { error: "Data hygiene failed" },
      { status: 500 }
    );
  }
}
