import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/api/require-admin";
import { isJunkTitle } from "@/lib/books/romance-filter";
import { isRomantasyDiscoveryCandidate } from "@/lib/books/discovery-focus";
import { queueEnrichmentJobs } from "@/lib/enrichment/queue";
import { getCorsHeaders, corsOptions } from "@/lib/api/cors";

export const runtime = "nodejs";
export const maxDuration = 120;

// ── Schema ──

const harvestBookSchema = z.object({
  title: z.string().min(1).max(500),
  author: z.string().max(300).optional().nullable(),
  isbn13: z.string().optional().nullable(),
  goodreadsId: z.string().max(20).optional().nullable(),
  asin: z.string().max(20).optional().nullable(),
  seriesName: z.string().max(200).optional().nullable(),
  seriesPosition: z.number().int().min(0).max(100).optional().nullable(),
  coverUrl: z.string().max(2000).optional().nullable(),
  goodreadsRating: z.number().min(0).max(5).optional().nullable(),
  goodreadsRatingCount: z.number().int().min(0).optional().nullable(),
  amazonRating: z.number().min(0).max(5).optional().nullable(),
  amazonRatingCount: z.number().int().min(0).optional().nullable(),
  romanceIoSpice: z.number().int().min(1).max(5).optional().nullable(),
  romanceIoSlug: z.string().max(300).optional().nullable(),
  format: z.string().optional().nullable(),
  source: z.string().max(100),
});

const harvestPayloadSchema = z.object({
  books: z.array(harvestBookSchema).min(1).max(500),
});

type HarvestedBook = z.infer<typeof harvestBookSchema>;

// ── Helpers ──

const FOCUSED_HARVEST_SOURCES = new Set([
  "amazon_list",
  "romanceio",
  "generic_links",
  "blog_list",
]);

function cleanHarvestTitle(title: string): {
  title: string;
  seriesName: string | null;
  seriesPosition: number | null;
} {
  const compact = title.replace(/\s+/g, " ").trim();
  const seriesMatch = compact.match(/\(([^)]*?)\s+#?(\d+(?:\.\d+)?)\)\s*$/);
  const withoutSeries = seriesMatch
    ? compact.replace(/\s*\([^)]*?\s+#?\d+(?:\.\d+)?\)\s*$/, "")
    : compact;

  const cleaned = withoutSeries
    .replace(/:\s+(?:a\s+|an\s+|the\s+)?(?:slow[-\s]?burn|fast[-\s]?paced|epic|dark|steamy|spicy|enemies[-\s]?to[-\s]?lovers|forbidden|romantic|fantasy|romantasy|paranormal|vampire|wolf|shifter|fae|witch|monster|alien|gothic|high[-\s]?stakes|stunning|immersive|discover|novel|book)\b.*$/i, "")
    .trim();

  return {
    title: cleaned || compact,
    seriesName: seriesMatch?.[1]?.trim() ?? null,
    seriesPosition: seriesMatch ? Math.floor(Number(seriesMatch[2])) : null,
  };
}

function stripAuthorFromTitle(title: string, author?: string | null): string {
  if (!author) return title;
  const suffix = ` by ${author}`.toLowerCase().replace(/\s+/g, " ");
  const normalizedTitle = title.toLowerCase().replace(/\s+/g, " ");
  if (!normalizedTitle.endsWith(suffix)) return title;
  return title.slice(0, title.length - suffix.length).trim();
}

function cleanHarvestCoverUrl(coverUrl?: string | null): string | null {
  if (!coverUrl || coverUrl.includes("placeholder.png")) return null;
  return coverUrl;
}

function normalizeRomanceIoSlug(slug?: string | null): string | null {
  if (!slug) return null;
  return slug.split("/").filter(Boolean)[0] || null;
}

function sanitizeHarvestBook(book: HarvestedBook): HarvestedBook {
  const cleaned = cleanHarvestTitle(book.title);
  return {
    ...book,
    title: stripAuthorFromTitle(cleaned.title, book.author),
    coverUrl: cleanHarvestCoverUrl(book.coverUrl),
    romanceIoSlug: normalizeRomanceIoSlug(book.romanceIoSlug),
    seriesName: book.seriesName ?? cleaned.seriesName,
    seriesPosition: book.seriesPosition ?? cleaned.seriesPosition,
  };
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/:\s+(?:a\s+|an\s+|the\s+)?(?:slow[-\s]?burn|fast[-\s]?paced|epic|dark|steamy|spicy|enemies[-\s]?to[-\s]?lovers|forbidden|romantic|fantasy|romantasy|paranormal|vampire|wolf|shifter|fae|witch|monster|alien|gothic|high[-\s]?stakes|stunning|immersive|discover|novel|book)\b.*$/i, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\b(?:book|volume)\s+\d+\b/gi, "")
    .replace(/['']/g, "'")
    .replace(/[^a-z0-9'\s]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(the|a|an)\s+/i, "")
    .trim();
}

function computeUpdates(
  existing: Record<string, unknown>,
  harvested: HarvestedBook
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (!existing.goodreads_id && harvested.goodreadsId)
    updates.goodreads_id = harvested.goodreadsId;
  if (!existing.amazon_asin && harvested.asin)
    updates.amazon_asin = harvested.asin;
  if (!existing.cover_url && harvested.coverUrl)
    updates.cover_url = harvested.coverUrl;
  const existingRomanceIoSlug = normalizeRomanceIoSlug(
    typeof existing.romance_io_slug === "string" ? existing.romance_io_slug : null
  );
  if (
    harvested.romanceIoSlug &&
    existingRomanceIoSlug !== harvested.romanceIoSlug
  )
    updates.romance_io_slug = harvested.romanceIoSlug;
  if (!existing.series_name && harvested.seriesName) {
    updates.series_name = harvested.seriesName;
    updates.series_position = harvested.seriesPosition;
  }
  return updates;
}

async function findExistingBook(
  supabase: ReturnType<typeof getAdminClient>,
  book: HarvestedBook
): Promise<{ id: string; needsUpdate: Record<string, unknown> } | null> {
  const selectFields = "id, amazon_asin, goodreads_id, cover_url, romance_io_slug, series_name";

  // 1. Goodreads ID match
  if (book.goodreadsId) {
    const { data } = await supabase
      .from("books")
      .select(selectFields)
      .eq("goodreads_id", book.goodreadsId)
      .single();
    if (data) return { id: data.id, needsUpdate: computeUpdates(data, book) };
  }

  // 2. ASIN match
  if (book.asin) {
    const { data } = await supabase
      .from("books")
      .select(selectFields)
      .eq("amazon_asin", book.asin)
      .single();
    if (data) return { id: data.id, needsUpdate: computeUpdates(data, book) };
  }

  // 3. ISBN13 match
  if (book.isbn13) {
    const { data } = await supabase
      .from("books")
      .select(selectFields)
      .eq("isbn13", book.isbn13)
      .single();
    if (data) return { id: data.id, needsUpdate: computeUpdates(data, book) };
  }

  // 4. Romance.io slug match. Older harvests sometimes stored the full path
  // (`slug/title/similar`), so match both exact and prefix forms.
  if (book.romanceIoSlug) {
    const { data: exactMatch } = await supabase
      .from("books")
      .select(selectFields)
      .eq("romance_io_slug", book.romanceIoSlug)
      .single();
    if (exactMatch) {
      return { id: exactMatch.id, needsUpdate: computeUpdates(exactMatch, book) };
    }

    const { data: prefixMatches } = await supabase
      .from("books")
      .select(selectFields)
      .ilike("romance_io_slug", `${book.romanceIoSlug}/%`)
      .limit(1);
    const prefixMatch = prefixMatches?.[0];
    if (prefixMatch) {
      return { id: prefixMatch.id, needsUpdate: computeUpdates(prefixMatch, book) };
    }
  }

  // 5. Normalized title + author last name
  const normTitle = normalizeTitle(book.title);
  const authorLastName = (book.author || "").split(" ").pop()?.toLowerCase() ?? "";
  if (normTitle && authorLastName) {
    const { data: candidates } = await supabase
      .from("books")
      .select(`${selectFields}, title, author`)
      .ilike("author", `%${authorLastName}%`)
      .limit(30);

    const match = candidates?.find(
      (c) => {
        const candidateTitle = normalizeTitle(c.title);
        return (
          candidateTitle === normTitle ||
          (candidateTitle.length >= 8 && normTitle.startsWith(candidateTitle)) ||
          (normTitle.length >= 8 && candidateTitle.startsWith(normTitle))
        );
      }
    );
    if (match) return { id: match.id, needsUpdate: computeUpdates(match, book) };
  }

  return null;
}

async function writeHarvestRatings(
  supabase: ReturnType<typeof getAdminClient>,
  bookId: string,
  book: HarvestedBook
): Promise<void> {
  const now = new Date().toISOString();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

  // Goodreads rating
  if (book.goodreadsRating != null && book.goodreadsRating > 0) {
    const { data: existing } = await supabase
      .from("book_ratings")
      .select("scraped_at")
      .eq("book_id", bookId)
      .eq("source", "goodreads")
      .single();

    const isStale =
      !existing ||
      Date.now() - new Date(existing.scraped_at).getTime() > SEVEN_DAYS;

    if (isStale) {
      await supabase.from("book_ratings").upsert(
        {
          book_id: bookId,
          source: "goodreads",
          rating: book.goodreadsRating,
          rating_count: book.goodreadsRatingCount || null,
          scraped_at: now,
        },
        { onConflict: "book_id,source" }
      );
    }
  }

  // Amazon rating
  if (book.amazonRating != null && book.amazonRating > 0) {
    const { data: existing } = await supabase
      .from("book_ratings")
      .select("scraped_at")
      .eq("book_id", bookId)
      .eq("source", "amazon")
      .single();

    const isStale =
      !existing ||
      Date.now() - new Date(existing.scraped_at).getTime() > SEVEN_DAYS;

    if (isStale) {
      await supabase.from("book_ratings").upsert(
        {
          book_id: bookId,
          source: "amazon",
          rating: book.amazonRating,
          rating_count: book.amazonRatingCount || null,
          scraped_at: now,
        },
        { onConflict: "book_id,source" }
      );
    }
  }

  // Romance.io spice → write to spice_signals (new architecture)
  if (book.romanceIoSpice != null) {
    const { data: existing } = await supabase
      .from("spice_signals")
      .select("source")
      .eq("book_id", bookId)
      .eq("source", "romance_io")
      .single();

    if (!existing) {
      await supabase.from("spice_signals").upsert(
        {
          book_id: bookId,
          source: "romance_io",
          spice_value: book.romanceIoSpice,
          confidence: 0.6, // harvest = medium; direct Serper scrape = 0.7-0.85
          evidence: { harvested: true, harvestSource: book.source },
        },
        { onConflict: "book_id,source" }
      );
    }
  }
}

// ── Main handler ──

export function OPTIONS(req: Request) {
  return corsOptions(req.headers.get("origin"));
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const headers = getCorsHeaders(origin);

  // Auth: admin session or CRON_SECRET (used by extension + cron)
  const authHeader = request.headers.get("authorization");
  const auth = await requireAdmin();
  let userId: string | null = null;
  if ("error" in auth) {
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401, headers }
      );
    }
  } else {
    userId = auth.userId;
  }

  // Parse + validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers });
  }

  const parsed = harvestPayloadSchema.safeParse(body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    console.warn("[harvest] Validation failed:", JSON.stringify(flat).slice(0, 500));
    return NextResponse.json(
      { error: "Validation failed", details: flat },
      { status: 400, headers }
    );
  }

  const supabase = getAdminClient();
  const { books } = parsed.data;

  let added = 0;
  let updated = 0;
  let skipped = 0;
  let skippedAudiobooks = 0;
  let skippedJunk = 0;
  let skippedOutOfFocus = 0;
  let enrichmentJobsQueued = 0;
  const newBooks: string[] = [];
  const updatedBooks: string[] = [];
  const sources = new Set<string>();

  for (const rawBook of books) {
    const book = sanitizeHarvestBook(rawBook);
    sources.add(book.source);

    // 1. Skip audiobooks
    if (book.format === "audiobook") {
      skippedAudiobooks++;
      skipped++;
      continue;
    }

    // 2. Skip junk titles
    if (isJunkTitle(book.title, book.author || undefined)) {
      skippedJunk++;
      skipped++;
      continue;
    }

    // 3. Skip broad/non-focus titles from high-noise harvest sources.
    // Amazon category pages can drift into general fiction, kids, and broad
    // contemporary romance. Keep these pulls focused on romantasy-adjacent demand.
    if (
      FOCUSED_HARVEST_SOURCES.has(book.source) &&
      !isRomantasyDiscoveryCandidate({
        title: book.title,
        author: book.author,
        context: [book.source, book.seriesName].filter(Boolean).join(" "),
      })
    ) {
      skippedOutOfFocus++;
      skipped++;
      continue;
    }

    // 4. Check for existing book
    const existing = await findExistingBook(supabase, book);

    if (existing) {
      // 5. Existing book — merge new data
      const updates = existing.needsUpdate;
      if (Object.keys(updates).length > 0) {
        await supabase.from("books").update(updates).eq("id", existing.id);
        const updateDesc = Object.keys(updates)
          .map((k) => `added ${k.replace(/_/g, " ")}`)
          .join(", ");
        updatedBooks.push(`${book.title} (${updateDesc})`);
        updated++;
      } else {
        skipped++;
      }

      // Write pre-captured ratings for existing books too
      await writeHarvestRatings(supabase, existing.id, book);
    } else {
      // 6. New book — create record
      const { data: newBook, error } = await supabase
        .from("books")
        .insert({
          title: book.title,
          author: book.author,
          isbn13: book.isbn13 || null,
          goodreads_id: book.goodreadsId || null,
          amazon_asin: book.asin || null,
          series_name: book.seriesName || null,
          series_position: book.seriesPosition || null,
          romance_io_slug: book.romanceIoSlug || null,
          cover_url: book.coverUrl || null,
          enrichment_status: "pending",
          discovery_source: book.source,
        })
        .select("id")
        .single();

      if (error || !newBook) {
        console.warn(`[harvest] Failed to insert "${book.title}":`, error?.message);
        skipped++;
        continue;
      }

      // Write pre-captured ratings
      await writeHarvestRatings(supabase, newBook.id, book);

      // Queue enrichment — skip jobs already satisfied by harvest data
      const skipJobs = new Set<string>();
      if (book.goodreadsId) skipJobs.add("goodreads_detail");
      if (book.goodreadsRating != null) skipJobs.add("goodreads_rating");
      if (book.asin && book.amazonRating != null) skipJobs.add("amazon_rating");
      if (book.romanceIoSpice != null) skipJobs.add("romance_io_spice");

      await queueEnrichmentJobs(newBook.id, book.title, book.author || "Unknown", skipJobs, "core");
      enrichmentJobsQueued += 5 - skipJobs.size;

      newBooks.push(`${book.title} by ${book.author}`);
      added++;
    }
  }

  // 8. Log the harvest
  await supabase.from("harvest_log").insert({
    user_id: userId,
    books_submitted: books.length,
    books_added: added,
    books_updated: updated,
    books_skipped: skipped,
    sources: Array.from(sources),
  });

  console.log(
    `[harvest] Processed ${books.length} books: ${added} added, ${updated} updated, ${skipped} skipped (${skippedAudiobooks} audiobooks, ${skippedJunk} junk, ${skippedOutOfFocus} out of focus)`
  );

  return NextResponse.json({
    success: true,
    added,
    updated,
    skipped,
    skippedAudiobooks,
    skippedJunk,
    skippedOutOfFocus,
    enrichmentJobsQueued,
    details: { newBooks, updatedBooks },
  }, { headers });
}
