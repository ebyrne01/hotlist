/**
 * DISCUSSION LINKS ENRICHMENT
 *
 * Queries Serper for Reddit threads and blog posts discussing a book.
 * Stores curated links in book_discussion_links table.
 * Cost: 3 Serper credits per book (~$0.003).
 */

import { shouldSkipQuery, cacheResult } from "@/lib/scraping/serper-cache";
import { getAdminClient } from "@/lib/supabase/admin";

interface SerperResult {
  title: string;
  link: string;
  snippet?: string;
}

interface DiscussionLink {
  url: string;
  title: string;
  source: string;
  sourceDetail: string | null;
  commentCount: number | null;
}

/** Extract subreddit name from a Reddit URL */
function extractSubreddit(url: string): string | null {
  const match = url.match(/reddit\.com\/r\/([^/]+)/);
  return match ? `r/${match[1]}` : null;
}

/** Determine source type from URL */
function classifySource(url: string): { source: string; sourceDetail: string | null } {
  if (url.includes("reddit.com")) {
    return { source: "reddit", sourceDetail: extractSubreddit(url) };
  }
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return { source: "blog", sourceDetail: hostname };
  } catch {
    return { source: "blog", sourceDetail: null };
  }
}

/** Run a single Serper query and return parsed links */
async function querySerper(
  apiKey: string,
  query: string,
  limit: number,
  tag: string
): Promise<DiscussionLink[]> {
  if (await shouldSkipQuery(query)) {
    return [];
  }

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: limit, gl: "us" }),
    });

    if (!res.ok) {
      console.warn(`[discussion-links][${tag}] Serper returned ${res.status}`);
      await cacheResult(query, "error");
      return [];
    }

    const data = await res.json();
    const organic = (data.organic as SerperResult[] | undefined) ?? [];

    if (organic.length === 0) {
      await cacheResult(query, "no_data");
      return [];
    }

    await cacheResult(query, "hit");

    return organic.slice(0, limit).map((r) => {
      const { source, sourceDetail } = classifySource(r.link);
      // Try to extract comment count from Reddit snippets (e.g. "42 comments")
      let commentCount: number | null = null;
      if (source === "reddit" && r.snippet) {
        const m = r.snippet.match(/(\d+)\s+comments?/i);
        if (m) commentCount = parseInt(m[1], 10);
      }
      return {
        url: r.link,
        title: r.title,
        source,
        sourceDetail,
        commentCount,
      };
    });
  } catch (err) {
    console.warn(`[discussion-links][${tag}] Failed:`, err);
    return [];
  }
}

export async function enrichDiscussionLinks(
  bookId: string,
  title: string,
  author: string
): Promise<{ linkCount: number } | null> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.warn("[discussion-links] SERPER_API_KEY not set, skipping");
    return null;
  }

  if (!title || !author) {
    console.warn("[discussion-links] Missing title or author, skipping");
    return null;
  }

  // Run 3 queries in parallel
  const [romanceReddit, fantasyReddit, blogs] = await Promise.all([
    querySerper(
      apiKey,
      `site:reddit.com/r/RomanceBooks "${title}" "${author}"`,
      3,
      "romance"
    ),
    querySerper(
      apiKey,
      `site:reddit.com/r/Fantasy "${title}" "${author}"`,
      2,
      "fantasy"
    ),
    querySerper(
      apiKey,
      `"${title}" "${author}" review OR discussion -site:amazon.com -site:goodreads.com`,
      2,
      "blogs"
    ),
  ]);

  // Merge and dedupe by URL
  const seen = new Set<string>();
  const allLinks: DiscussionLink[] = [];
  for (const link of [...romanceReddit, ...fantasyReddit, ...blogs]) {
    if (!seen.has(link.url)) {
      seen.add(link.url);
      allLinks.push(link);
    }
  }

  if (allLinks.length === 0) {
    console.log(`[discussion-links] "${title}": no links found`);
    return { linkCount: 0 };
  }

  // Upsert into book_discussion_links
  const supabase = getAdminClient();
  const rows = allLinks.slice(0, 7).map((l) => ({
    book_id: bookId,
    url: l.url,
    title: l.title,
    source: l.source,
    source_detail: l.sourceDetail,
    comment_count: l.commentCount,
  }));

  const { error } = await supabase
    .from("book_discussion_links")
    .upsert(rows, { onConflict: "book_id,url" });

  if (error) {
    console.warn(`[discussion-links] Upsert failed for "${title}":`, error.message);
    return null;
  }

  console.log(`[discussion-links] "${title}": ${allLinks.length} link(s) stored`);
  return { linkCount: allLinks.length };
}
