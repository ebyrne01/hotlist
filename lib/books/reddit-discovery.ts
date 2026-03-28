/**
 * REDDIT BUZZ DISCOVERY
 *
 * Scans romance-focused subreddits via Serper for book mentions.
 * Uses Claude Haiku to extract book titles from Reddit snippets,
 * then resolves each through Goodreads search and saves to the DB.
 *
 * Target subreddits: r/RomanceBooks, r/Romantasy, r/romancelandia, r/Fantasy
 *
 * Cost: ~$0.05/run (9 Serper queries + ~10 Haiku calls)
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { searchGoodreads, getGoodreadsBookById } from "./goodreads-search";
import { saveGoodreadsBookToCache } from "./cache";
import { queueEnrichmentJobs } from "@/lib/enrichment/queue";
import { scheduleMetadataEnrichment } from "./metadata-enrichment";
import { isJunkTitle, isRomanceByGenres } from "./romance-filter";
import { recordBuzzSignalsBatch } from "./buzz-signals";

const GOODREADS_DELAY_MS = 1500;
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serper queries targeting romance discussion on Reddit.
 * Uses the current year so results stay fresh.
 */
function getDiscoveryQueries(): string[] {
  const year = new Date().getFullYear();
  return [
    `site:reddit.com/r/RomanceBooks "just finished" ${year}`,
    `site:reddit.com/r/RomanceBooks "can't stop thinking about"`,
    `site:reddit.com/r/RomanceBooks "just read" recommend`,
    `site:reddit.com/r/RomanceBooks "best books" ${year}`,
    `site:reddit.com/r/Romantasy recommend ${year}`,
    `site:reddit.com/r/Romantasy "just finished"`,
    `site:reddit.com/r/Romantasy "favorite" ${year}`,
    `site:reddit.com/r/romancelandia "reading" ${year}`,
    `site:reddit.com/r/Fantasy romantasy ${year}`,
  ];
}

interface ExtractedBook {
  title: string;
  author: string | null;
}

interface DiscoveryProgress {
  queriesRun: number;
  snippetsProcessed: number;
  titlesExtracted: number;
  resolved: number;
  added: number;
  skipped: number;
  errors: number;
}

/**
 * Use Claude Haiku to extract book titles from a Reddit snippet.
 */
async function extractBooksFromSnippet(
  snippet: string,
  apiKey: string
): Promise<ExtractedBook[]> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 300,
        system:
          "Extract any specific book titles and author names mentioned in this Reddit snippet. Only include titles that clearly refer to a specific published book (not generic phrases like 'a good romance' or series names without a specific book). Return a JSON array: [{title: string, author: string | null}]. If no specific books are mentioned, return [].",
        messages: [{ role: "user", content: snippet }],
      }),
    });

    if (!res.ok) return [];

    const data = await res.json();
    const text = data.content?.[0]?.text ?? "[]";

    // Extract JSON from the response (Haiku sometimes wraps in markdown)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (b: { title?: string }) =>
          b.title && typeof b.title === "string" && b.title.length > 2
      )
      .map((b: { title: string; author?: string }) => ({
        title: b.title.trim(),
        author: b.author?.trim() ?? null,
      }));
  } catch {
    return [];
  }
}

/**
 * Run a single Serper search and return organic results.
 */
async function searchSerper(
  apiKey: string,
  query: string
): Promise<{ title?: string; snippet?: string; link?: string }[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: 10 }),
  });

  if (!res.ok) {
    console.warn(`[reddit-discovery] Serper returned ${res.status}`);
    return [];
  }

  const data = await res.json();
  return data.organic ?? [];
}

/**
 * Discover books from Reddit romance communities and add to the database.
 *
 * @param timeBudgetMs Max time to spend (0 = unlimited)
 * @param onProgress Optional log callback
 */
export async function discoverRedditBuzz(
  timeBudgetMs = 0,
  onProgress?: (msg: string) => void
): Promise<DiscoveryProgress> {
  const serperKey = process.env.SERPER_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!serperKey || !anthropicKey) {
    console.warn("[reddit-discovery] SERPER_API_KEY or ANTHROPIC_API_KEY not set");
    return {
      queriesRun: 0,
      snippetsProcessed: 0,
      titlesExtracted: 0,
      resolved: 0,
      added: 0,
      skipped: 0,
      errors: 0,
    };
  }

  const startTime = Date.now();
  const progress: DiscoveryProgress = {
    queriesRun: 0,
    snippetsProcessed: 0,
    titlesExtracted: 0,
    resolved: 0,
    added: 0,
    skipped: 0,
    errors: 0,
  };

  const supabase = getAdminClient();
  const queries = getDiscoveryQueries();

  // Step 1: Collect snippets from all queries
  const allSnippets: string[] = [];
  for (const query of queries) {
    if (timeBudgetMs > 0 && Date.now() - startTime > timeBudgetMs * 0.2) break;

    try {
      const results = await searchSerper(serperKey, query);
      progress.queriesRun++;

      for (const result of results) {
        const snippet = [result.title, result.snippet].filter(Boolean).join(" — ");
        if (snippet.length > 20) {
          allSnippets.push(snippet);
        }
      }

      onProgress?.(
        `[reddit-discovery] Query "${query.slice(0, 60)}..." → ${results.length} results`
      );
    } catch {
      progress.errors++;
    }
  }

  onProgress?.(
    `[reddit-discovery] ${allSnippets.length} snippets from ${progress.queriesRun} queries`
  );

  // Step 2: Extract book titles from snippets via Haiku
  // Batch snippets to reduce Haiku calls — combine 3-5 snippets per call
  const BATCH_SIZE = 4;
  const allBooks: ExtractedBook[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < allSnippets.length; i += BATCH_SIZE) {
    if (timeBudgetMs > 0 && Date.now() - startTime > timeBudgetMs * 0.5) break;

    const batch = allSnippets.slice(i, i + BATCH_SIZE);
    const combined = batch.map((s, idx) => `Snippet ${idx + 1}: ${s}`).join("\n\n");

    const extracted = await extractBooksFromSnippet(combined, anthropicKey);
    progress.snippetsProcessed += batch.length;

    for (const book of extracted) {
      const key = book.title.toLowerCase();
      if (seen.has(key)) continue;
      if (isJunkTitle(book.title)) continue;
      seen.add(key);
      allBooks.push(book);
    }
  }

  progress.titlesExtracted = allBooks.length;
  onProgress?.(
    `[reddit-discovery] ${allBooks.length} unique titles extracted from ${progress.snippetsProcessed} snippets`
  );

  // Step 3: Check which are already in our database — record buzz for existing books
  const toResolve: ExtractedBook[] = [];
  const existingBuzzIds: string[] = [];
  for (const book of allBooks) {
    const { data } = await supabase
      .from("books")
      .select("id")
      .ilike("title", book.title)
      .limit(1);

    if (data && data.length > 0) {
      existingBuzzIds.push(data[0].id);
      progress.skipped++;
    } else {
      toResolve.push(book);
    }
  }

  // Record buzz signals for books already in our DB
  if (existingBuzzIds.length > 0) {
    await recordBuzzSignalsBatch(
      existingBuzzIds.map((id) => ({ bookId: id, source: "reddit_mention" as const }))
    );
    onProgress?.(
      `[reddit-discovery] Recorded buzz signals for ${existingBuzzIds.length} existing books`
    );
  }

  onProgress?.(
    `[reddit-discovery] ${toResolve.length} new titles to resolve (${progress.skipped} already in DB)`
  );

  // Step 4: Resolve each new title via Goodreads search
  for (const book of toResolve) {
    if (timeBudgetMs > 0 && Date.now() - startTime > timeBudgetMs) break;

    try {
      await sleep(GOODREADS_DELAY_MS);

      const searchQuery = book.author
        ? `${book.title} ${book.author}`
        : book.title;
      const results = await searchGoodreads(searchQuery);
      if (!results || results.length === 0) {
        progress.errors++;
        continue;
      }

      // Find best match
      const titleLower = book.title.toLowerCase();
      const best =
        results.find((r) =>
          r.title.toLowerCase().includes(titleLower.slice(0, 20))
        ) ?? results[0];

      if (!best?.goodreadsId) {
        progress.errors++;
        continue;
      }

      progress.resolved++;

      // Fetch full details from Goodreads
      const detail = await getGoodreadsBookById(best.goodreadsId);
      if (!detail) {
        progress.errors++;
        continue;
      }

      // Romance gate
      const genres = detail.genres ?? [];
      if (genres.length > 0 && !isRomanceByGenres(genres)) {
        progress.skipped++;
        continue;
      }

      const saved = await saveGoodreadsBookToCache({
        title: detail.title,
        author: detail.author,
        goodreadsId: detail.goodreadsId,
        goodreadsUrl: detail.goodreadsUrl,
        coverUrl: detail.coverUrl,
        description: detail.description,
        seriesName: detail.seriesName,
        seriesPosition: detail.seriesPosition,
        publishedYear: detail.publishedYear,
        pageCount: detail.pageCount,
        genres: detail.genres,
      });

      if (saved) {
        // Set discovery source + record buzz signal
        await supabase
          .from("books")
          .update({ discovery_source: "reddit_mention" })
          .eq("id", saved.id);
        await recordBuzzSignalsBatch([
          { bookId: saved.id, source: "reddit_mention" },
        ]);

        progress.added++;
        scheduleMetadataEnrichment(saved.id, saved.title, saved.author, saved.isbn);
        await queueEnrichmentJobs(saved.id, saved.title, saved.author);
        onProgress?.(
          `[reddit-discovery] Added "${saved.title}" by ${saved.author}`
        );
      } else {
        progress.skipped++;
      }
    } catch {
      progress.errors++;
    }
  }

  return progress;
}
