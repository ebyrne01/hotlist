/**
 * REDDIT BUZZ ENRICHMENT
 *
 * Queries Serper for Reddit mentions of a book across romance/fantasy subreddits.
 * Stores the mention count in book_buzz_signals (source: "reddit_mention").
 * Cost: 1 Serper credit per book (~$0.001).
 */

import { shouldSkipQuery, cacheResult } from "@/lib/scraping/serper-cache";
import { recordBuzzSignal } from "@/lib/books/buzz-signals";

export async function enrichRedditBuzz(
  bookId: string,
  title: string,
  author: string
): Promise<{ mentionCount: number } | null> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn("[reddit-buzz] SERPER_API_KEY not set, skipping");
    return null;
  }

  if (!title || !author) {
    console.warn("[reddit-buzz] Missing title or author, skipping");
    return null;
  }

  const query = `site:reddit.com/r/RomanceBooks OR site:reddit.com/r/Fantasy "${title}" "${author}"`;

  // Skip known misses
  if (await shouldSkipQuery(query)) {
    console.log(`[reddit-buzz] Skipping known miss: "${title}"`);
    return null;
  }

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 10, gl: "us" }),
    });

    if (!res.ok) {
      console.warn(`[reddit-buzz] Serper returned ${res.status} for "${title}"`);
      await cacheResult(query, "error");
      return null;
    }

    const data = await res.json();
    const organic = data.organic as { title: string; link: string }[] | undefined;
    const mentionCount = organic?.length ?? 0;

    if (mentionCount === 0) {
      await cacheResult(query, "no_data");
      return { mentionCount: 0 };
    }

    await cacheResult(query, "hit");

    // Record buzz signal with mention count in metadata
    await recordBuzzSignal(bookId, "reddit_mention", {
      mention_count: mentionCount,
      enriched: true,
    });

    console.log(`[reddit-buzz] "${title}": ${mentionCount} Reddit mention(s)`);
    return { mentionCount };
  } catch (err) {
    console.warn(`[reddit-buzz] Failed for "${title}":`, err);
    return null;
  }
}
