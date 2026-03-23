import { NextRequest, NextResponse } from "next/server";
import { getNYTBestsellerRomance } from "@/lib/books/nyt-lists";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";
  const authHeader = request.headers.get("authorization");
  const isAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isDev && !isAuthorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const books = await getNYTBestsellerRomance();
    return NextResponse.json({
      success: true,
      count: books.length,
      titles: books.map(b => `${b.title} by ${b.author}`)
    });
  } catch (err) {
    console.error("[nyt/refresh] Failed:", err);
    return NextResponse.json({ error: "NYT fetch failed", details: String(err) }, { status: 500 });
  }
}
