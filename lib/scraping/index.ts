import { createClient } from "@supabase/supabase-js";
import { scrapeGoodreadsRating, type GoodreadsData } from "./goodreads";
import { scrapeAmazonRating, type AmazonData } from "./amazon";
import { inferSpiceFromGoodreadsShelves } from "./goodreads-spice";
import { getRomanceIoSpice } from "./romance-io-search";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { fetch: (...args) => fetch(args[0], { ...args[1], cache: "no-store" }) } }
  );
}

const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface EnrichmentResult {
  goodreads: GoodreadsData | null;
  amazon: AmazonData | null;
  spice: {
    level: number | null;
    source: "romance_io" | "goodreads_inference" | "hotlist_community" | null;
    confidence: "low" | "medium" | "high" | null;
    heatLabel: string | null;
  };
}

/**
 * Enrich a book with external ratings/spice data.
 * Only scrapes sources that are stale or missing.
 */
export async function enrichBookWithExternalData(
  bookId: string,
  title: string,
  author: string,
  isbn?: string | null
): Promise<EnrichmentResult> {
  const supabase = getAdminClient();
  const result: EnrichmentResult = {
    goodreads: null,
    amazon: null,
    spice: { level: null, source: null, confidence: null, heatLabel: null },
  };

  // Check which sources are stale
  const { data: existingRatings } = await supabase
    .from("book_ratings")
    .select("source, scraped_at")
    .eq("book_id", bookId);

  const { data: existingSpice } = await supabase
    .from("book_spice")
    .select("source, scraped_at")
    .eq("book_id", bookId);

  const now = Date.now();

  function isStale(source: string, table: typeof existingRatings): boolean {
    const row = table?.find((r) => r.source === source);
    if (!row) return true;
    return now - new Date(row.scraped_at).getTime() > STALE_MS;
  }

  // Track the Goodreads ID so we can use it for spice inference
  let goodreadsId: string | null = null;

  // Look up existing Goodreads ID from the books table
  const { data: bookRow } = await supabase
    .from("books")
    .select("goodreads_id")
    .eq("id", bookId)
    .single();
  if (bookRow?.goodreads_id) {
    goodreadsId = bookRow.goodreads_id;
  }

  // Run scrapers in parallel for stale sources
  const tasks: Promise<void>[] = [];

  if (isStale("goodreads", existingRatings)) {
    tasks.push(
      scrapeGoodreadsRating(title, author).then(async (data) => {
        result.goodreads = data;
        if (data) {
          await supabase.from("book_ratings").upsert(
            {
              book_id: bookId,
              source: "goodreads",
              rating: data.rating,
              rating_count: data.ratingCount,
              scraped_at: new Date().toISOString(),
            },
            { onConflict: "book_id,source" }
          );
          if (data.goodreadsId) {
            goodreadsId = data.goodreadsId;
            await supabase
              .from("books")
              .update({ goodreads_id: data.goodreadsId })
              .eq("id", bookId);
          }
        }
      })
    );
  }

  if (isStale("amazon", existingRatings)) {
    tasks.push(
      scrapeAmazonRating(isbn ?? null, null, title, author).then(async (data) => {
        result.amazon = data;
        if (data) {
          await supabase.from("book_ratings").upsert(
            {
              book_id: bookId,
              source: "amazon",
              rating: data.rating,
              rating_count: data.ratingCount,
              scraped_at: new Date().toISOString(),
            },
            { onConflict: "book_id,source" }
          );
          if (data.asin) {
            await supabase
              .from("books")
              .update({ amazon_asin: data.asin })
              .eq("id", bookId);
          }
        }
      })
    );
  }

  // Wait for Goodreads to finish first (we need the ID for spice inference)
  await Promise.allSettled(tasks);

  /**
   * SPICE ENRICHMENT PRIORITY
   *
   * 1. romance_io (HIGH confidence via Serper search)
   *    → Most trusted, clearest labeling, sends traffic to romance.io
   *    → Only used if confidence === 'high'
   *
   * 2. hotlist_community (≥5 user ratings)
   *    → Our own data, grows over time
   *    → Shown alongside romance.io when available, not instead of it
   *
   * 3. goodreads_inference
   *    → Fallback when neither above is available
   *    → Least precise, shown with appropriate caveat
   */

  // Check how many distinct authors share this title (for ambiguity detection)
  // Multiple editions of the same book by the same author shouldn't block lookup
  const { data: titleRows } = await supabase
    .from("books")
    .select("author")
    .ilike("title", title);
  const distinctAuthors = new Set(titleRows?.map((r) => r.author.toLowerCase()) ?? []);
  const titleCount = distinctAuthors.size;

  // Try romance.io via Google search index first
  const romanceIoStale = isStale("romance_io", existingSpice);
  if (romanceIoStale) {
    const romanceIo = await getRomanceIoSpice(title, author, titleCount ?? 0);

    if (romanceIo && romanceIo.confidence === "high") {
      result.spice = {
        level: romanceIo.spiceLevel,
        source: "romance_io",
        confidence: "high",
        heatLabel: romanceIo.heatLabel,
      };

      // Store in book_spice
      await supabase.from("book_spice").upsert(
        {
          book_id: bookId,
          source: "romance_io",
          spice_level: romanceIo.spiceLevel,
          confidence: "high",
          scraped_at: new Date().toISOString(),
        },
        { onConflict: "book_id,source" }
      );

      // Store romance.io metadata on the book record
      await supabase
        .from("books")
        .update({
          romance_io_slug: romanceIo.romanceIoSlug,
          romance_io_heat_label: romanceIo.heatLabel,
        })
        .eq("id", bookId);

      // Store romance.io star rating in book_ratings if parsed
      if (romanceIo.romanceIoRating !== null) {
        await supabase.from("book_ratings").upsert(
          {
            book_id: bookId,
            source: "romance_io",
            rating: romanceIo.romanceIoRating,
            scraped_at: new Date().toISOString(),
          },
          { onConflict: "book_id,source" }
        );
      }

      // Got a confident match — skip Goodreads inference
      return result;
    }

    // Medium confidence: store silently but don't display
    if (romanceIo && romanceIo.confidence === "medium") {
      await supabase.from("book_spice").upsert(
        {
          book_id: bookId,
          source: "romance_io",
          spice_level: romanceIo.spiceLevel,
          confidence: "medium",
          scraped_at: new Date().toISOString(),
        },
        { onConflict: "book_id,source" }
      );

      // Store slug for potential future use
      await supabase
        .from("books")
        .update({
          romance_io_slug: romanceIo.romanceIoSlug,
        })
        .eq("id", bookId);
    }
  }

  // Fallback: infer spice from Goodreads shelves
  if (goodreadsId && isStale("goodreads_inference", existingSpice)) {
    const spiceData = await inferSpiceFromGoodreadsShelves(
      goodreadsId,
      title,
      author
    );

    if (spiceData) {
      result.spice = {
        level: spiceData.spiceLevel,
        source: "goodreads_inference",
        confidence: spiceData.confidence,
        heatLabel: null,
      };

      await supabase.from("book_spice").upsert(
        {
          book_id: bookId,
          source: "goodreads_inference",
          spice_level: spiceData.spiceLevel,
          confidence: spiceData.confidence,
          rating_count: spiceData.shelfCount,
          scraped_at: new Date().toISOString(),
        },
        { onConflict: "book_id,source" }
      );
    }
  }

  return result;
}

/**
 * Fire-and-forget enrichment — call this when you don't want to block the user.
 */
export function scheduleEnrichment(
  bookId: string,
  title: string,
  author: string,
  isbn?: string | null
): void {
  console.log(`[enrichment] Starting for "${title}" (${bookId})`);

  enrichBookWithExternalData(bookId, title, author, isbn)
    .then((result) => {
      const sources = [
        result.goodreads ? "goodreads" : null,
        result.amazon ? "amazon" : null,
        result.spice.level
          ? `spice:${result.spice.level}/5 via ${result.spice.source} (${result.spice.confidence}${result.spice.heatLabel ? `, ${result.spice.heatLabel}` : ""})`
          : null,
      ].filter(Boolean);

      if (sources.length > 0) {
        console.log(`[enrichment] Completed "${title}": ${sources.join(", ")}`);
      } else {
        console.log(`[enrichment] No new data for "${title}" (all cached or failed)`);
      }
    })
    .catch((err) => {
      console.warn(`[enrichment] Failed for "${title}":`, err);
    });
}
