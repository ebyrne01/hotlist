/**
 * Automated data hygiene — detects and removes junk book entries.
 *
 * Catches scraping artifacts that slip through discovery channels:
 * garbled titles, summaries/study guides, box sets, non-book entries,
 * foreign-language edition duplicates, and "Unknown Author" junk.
 *
 * Runs weekly via /api/cron/data-hygiene. Zero API cost (SQL only).
 */

import { getAdminClient } from "@/lib/supabase/admin";
import { normalizeTitle } from "./utils";

interface CleanupResult {
  deleted: number;
  migrated: number;
  skippedWithUserData: string[];
  details: string[];
}

/**
 * Junk title patterns — books matching these should not be in the catalog.
 * Each pattern has a label for logging.
 */
const JUNK_PATTERNS: Array<{ label: string; sql: string }> = [
  {
    label: "garbled [Title] [By: Author] format",
    sql: `title ~ '^\\[.*\\]\\s*\\[By'`,
  },
  {
    label: "unknown edition AudioCD/Paperback/Hardcover/Leather Bound artifacts",
    sql: `title ~ '\\(unknown Edition\\)' OR title ~ '\\[AudioCD' OR title ~ '\\[Paperback\\]' OR title ~ '\\[Hardcover\\]' OR title ~ '\\[Leather Bound\\]'`,
  },
  {
    label: "summary/study guide parasites",
    sql: `title ~* '^Summary of ' OR title ~* '^SUMMARY OF ' OR title ~* '\\bStudy Guide\\b' OR title ~* '\\bSparknotes\\b' OR title ~* '\\bCliffsnotes\\b' OR title ~* '\\bBookcaps\\b'`,
  },
  {
    label: '"Written by / Published by" in title',
    sql: `title ~* 'Written by .*, \\d{4} Edition' OR title ~* 'Published by'`,
  },
  {
    label: "workbook/coloring/activity books",
    sql: `title ~* '\\bWorkbook for\\b' OR title ~* '\\bColoring Book\\b' OR title ~* '\\bActivity Book\\b'`,
  },
  {
    label: '"By Author - Title" inverted format',
    sql: `title ~ '^By\\s+\\w+\\s+\\w+\\s*-\\s*'`,
  },
  {
    label: "dramatized adaptation / abridged parts",
    sql: `title ~* '\\[Dramatized Adaptation\\]' OR title ~* '\\(Part \\d+ of \\d+\\)\\s*\\[' OR title ~* '\\bAbridged Edition\\b'`,
  },
  {
    label: "Wing and Claw / special edition bundles",
    sql: `title ~* '\\(Wing and Claw Collection\\)'`,
  },
  {
    label: "notebook / journal / diary / planner products",
    sql: `title ~* '\\bNotebook\\s*/\\s*Journal\\b' OR title ~* '\\bNotebook\\s*/\\s*Diary\\b' OR title ~* '\\bLined Journal\\b' OR title ~* '\\bDot Grid Journal\\b'`,
  },
  {
    label: "biography year format (e.g. 'Biography 2025')",
    sql: `title ~* '\\bBiography\\s+\\d{4}\\b'`,
  },
  {
    label: "101 Facts / trivia books about other books",
    sql: `title ~* '\\d+\\s+(Amazingly\\s+)?True\\s+Facts' OR title ~* '\\bTrivia\\s+Questions\\b'`,
  },
  {
    label: "textbooks (pharmacology, nursing, etc.)",
    sql: `title ~* '\\bPharmacology\\b' OR title ~* '\\bNursing Process\\b' OR title ~* '\\bExegetical\\b'`,
  },
  {
    label: "edition format artifacts in title",
    sql: `title ~* '\\bMass Market Paperback\\b' OR title ~* '\\bUnabridged CD Audio\\b'`,
  },
  {
    label: "knitting / craft / cooking tie-ins",
    sql: `title ~* '\\bKnit Along\\b' OR title ~* '\\bKnitting Pattern\\b'`,
  },
  {
    label: "'{' bracket author format scraping artifact",
    sql: `title ~ '^\\{\\s*\\[' AND title ~* 'AUTHOR'`,
  },
  {
    label: "Bookclub-in-a-Box discussion guides",
    sql: `title ~* '\\bBookclub.in.a.Box\\b' OR title ~* '\\bBook Club in a Box\\b'`,
  },
  {
    label: "Yearbook / Playbill / Directory entries",
    sql: `title ~* '\\bYearbook\\b' OR title ~* '\\bPlaybill\\b' OR title ~* '\\bDirectory\\b'`,
  },
  {
    label: "'+ FREE' bonus book bundled titles",
    sql: `title ~* '\\+\\s*FREE\\s+'`,
  },
  {
    label: "legal/government documents",
    sql: `title ~* '\\bCourt of Appeal\\b' OR title ~* '\\bNational Labor Relations\\b' OR title ~* '\\bFlood Control\\b'`,
  },
];

/**
 * Non-book patterns for "Unknown Author" entries.
 * These are magazines, directories, yearbooks, etc. that Goodreads indexes.
 */
const NON_BOOK_KEYWORDS = [
  "Telephone Directory",
  "Meteorological Magazine",
  "Mathematical Monthly",
  "Victorian Naturalist",
  "Social Register",
  "Supreme Court",
  "Merchant Vessels",
  "Appellate Division",
  "Annual of the University",
  "Teachers' Association",
  "Elite Planner",
];

/**
 * Check if a book has user-facing references that need migration.
 */
async function hasUserData(
  supabase: ReturnType<typeof getAdminClient>,
  bookId: string
): Promise<{ hotlists: number; ratings: number }> {
  const [{ count: hotlists }, { count: ratings }] = await Promise.all([
    supabase
      .from("hotlist_books")
      .select("*", { count: "exact", head: true })
      .eq("book_id", bookId),
    supabase
      .from("user_ratings")
      .select("*", { count: "exact", head: true })
      .eq("book_id", bookId),
  ]);
  return { hotlists: hotlists ?? 0, ratings: ratings ?? 0 };
}

/**
 * Find canonical version of a junk book by normalized title matching.
 * Returns the canonical book ID if found.
 */
async function findCanonical(
  supabase: ReturnType<typeof getAdminClient>,
  junkTitle: string,
  junkId: string
): Promise<string | null> {
  // Extract the real title from common junk patterns
  const cleanTitle = junkTitle
    .replace(/^\[?\(?\s*/, "") // Leading brackets
    .replace(/\]\s*\[By.*$/i, "") // [By: Author] suffix
    .replace(/\]\s*\[Author.*$/i, "")
    .replace(/by\s+[\w\s,]+$/i, "") // "by Author Name"
    .replace(/\s*-\s*[\w\s.]+$/i, "") // "- Author Name"
    .replace(/\(unknown Edition\).*$/i, "")
    .replace(/\[AudioCD.*$/i, "")
    .replace(/\[Paperback.*$/i, "")
    .replace(/\[Hardcover.*$/i, "")
    .replace(/^Summary of\s+/i, "")
    .replace(/^SUMMARY OF\s+/i, "")
    .replace(/:\s*Conversation Starters.*$/i, "")
    .replace(/:\s*Chapter-by-Chapter.*$/i, "")
    .replace(/:\s*A Novel$/i, "")
    .trim();

  if (cleanTitle.length < 3) return null;

  const norm = normalizeTitle(cleanTitle);
  if (!norm || norm.length < 2) return null;

  // Search for books with matching normalized title (excluding the junk entry itself)
  const { data: candidates } = await supabase
    .from("books")
    .select("id, title, author")
    .neq("id", junkId)
    .neq("author", "Unknown Author")
    .limit(50);

  if (!candidates) return null;

  for (const c of candidates) {
    if (normalizeTitle(c.title) === norm) {
      return c.id;
    }
  }

  return null;
}

/**
 * Delete a junk book and all its FK dependencies.
 * Migrates hotlist_books and user_ratings to canonical if available.
 */
async function deleteJunkBook(
  supabase: ReturnType<typeof getAdminClient>,
  bookId: string,
  canonicalId: string | null
): Promise<{ migrated: boolean }> {
  let migrated = false;

  // Migrate user data to canonical if available
  if (canonicalId) {
    // Migrate hotlist_books (skip if canonical already in same hotlist)
    const { data: hotlistRefs } = await supabase
      .from("hotlist_books")
      .select("hotlist_id")
      .eq("book_id", bookId);

    if (hotlistRefs && hotlistRefs.length > 0) {
      const { data: existingHotlists } = await supabase
        .from("hotlist_books")
        .select("hotlist_id")
        .eq("book_id", canonicalId);

      const existingSet = new Set(
        existingHotlists?.map((h) => h.hotlist_id) ?? []
      );

      for (const ref of hotlistRefs) {
        if (!existingSet.has(ref.hotlist_id)) {
          await supabase
            .from("hotlist_books")
            .update({ book_id: canonicalId })
            .eq("book_id", bookId)
            .eq("hotlist_id", ref.hotlist_id);
          migrated = true;
        }
      }
    }

    // Migrate user_ratings (skip if user already rated canonical)
    const { data: ratingRefs } = await supabase
      .from("user_ratings")
      .select("user_id")
      .eq("book_id", bookId);

    if (ratingRefs && ratingRefs.length > 0) {
      const { data: existingRatings } = await supabase
        .from("user_ratings")
        .select("user_id")
        .eq("book_id", canonicalId);

      const existingSet = new Set(
        existingRatings?.map((r) => r.user_id) ?? []
      );

      for (const ref of ratingRefs) {
        if (!existingSet.has(ref.user_id)) {
          await supabase
            .from("user_ratings")
            .update({ book_id: canonicalId })
            .eq("book_id", bookId)
            .eq("user_id", ref.user_id);
          migrated = true;
        }
      }
    }
  }

  // Delete all FK dependencies then the book itself
  await supabase.from("quality_flags").delete().eq("book_id", bookId);
  await supabase.from("book_tropes").delete().eq("book_id", bookId);
  await supabase.from("book_ratings").delete().eq("book_id", bookId);
  await supabase.from("book_recommendations").delete().eq("book_id", bookId);
  await supabase.from("book_recommendations").delete().eq("recommended_book_id", bookId);
  await supabase.from("spice_signals").delete().eq("book_id", bookId);
  await supabase.from("enrichment_queue").delete().eq("book_id", bookId);
  await supabase.from("book_spice").delete().eq("book_id", bookId);
  await supabase.from("creator_book_mentions").delete().eq("book_id", bookId);
  await supabase.from("book_buzz_signals").delete().eq("book_id", bookId);
  await supabase.from("hotlist_books").delete().eq("book_id", bookId);
  await supabase.from("user_ratings").delete().eq("book_id", bookId);
  await supabase.from("reading_status").delete().eq("book_id", bookId);
  await supabase.from("books").delete().eq("id", bookId);

  return { migrated };
}

/**
 * Main cleanup function. Finds and removes junk entries.
 * Safe: skips any book with user data unless a canonical version exists to migrate to.
 */
export async function runDataHygiene(): Promise<CleanupResult> {
  const supabase = getAdminClient();
  const result: CleanupResult = {
    deleted: 0,
    migrated: 0,
    skippedWithUserData: [],
    details: [],
  };

  // Phase 1: Pattern-based junk detection
  for (const pattern of JUNK_PATTERNS) {
    const { data: junkBooks } = await supabase
      .from("books")
      .select("id, title, author")
      .or(pattern.sql);

    if (!junkBooks || junkBooks.length === 0) continue;

    for (const book of junkBooks) {
      const userData = await hasUserData(supabase, book.id);
      const canonicalId = await findCanonical(supabase, book.title, book.id);

      if (userData.hotlists > 0 || userData.ratings > 0) {
        if (!canonicalId) {
          result.skippedWithUserData.push(
            `${book.title} (${userData.hotlists} hotlists, ${userData.ratings} ratings)`
          );
          continue;
        }
      }

      const { migrated } = await deleteJunkBook(supabase, book.id, canonicalId);
      result.deleted++;
      if (migrated) result.migrated++;
      result.details.push(`[${pattern.label}] ${book.title}`);
    }
  }

  // Phase 2: "Unknown Author" non-book entries (magazines, directories, etc.)
  const { data: unknownAuthors } = await supabase
    .from("books")
    .select("id, title")
    .eq("author", "Unknown Author");

  if (unknownAuthors) {
    for (const book of unknownAuthors) {
      // Check if title matches a known non-book pattern
      const isNonBook = NON_BOOK_KEYWORDS.some((kw) =>
        book.title.includes(kw)
      );

      // Also catch "Title by Author" format with Unknown Author (scraping artifacts)
      const isTitleByAuthor = /^.+\s+by\s+[A-Z][\w\s,.']+$/i.test(book.title);

      // And "Title - Author" format
      const isTitleDashAuthor = /^.+\s+-\s+[A-Z][\w\s.']+$/.test(book.title);

      if (!isNonBook && !isTitleByAuthor && !isTitleDashAuthor) continue;

      const userData = await hasUserData(supabase, book.id);
      const canonicalId = await findCanonical(supabase, book.title, book.id);

      if (userData.hotlists > 0 || userData.ratings > 0) {
        if (!canonicalId) {
          result.skippedWithUserData.push(
            `${book.title} (${userData.hotlists} hotlists, ${userData.ratings} ratings)`
          );
          continue;
        }
      }

      const { migrated } = await deleteJunkBook(supabase, book.id, canonicalId);
      result.deleted++;
      if (migrated) result.migrated++;
      result.details.push(`[Unknown Author junk] ${book.title}`);
    }
  }

  // Phase 3: Box sets / omnibus / bundles (multi-book entries)
  const { data: boxSets } = await supabase
    .from("books")
    .select("id, title")
    .or(
      `title.ilike.%box set%,title.ilike.%boxed set%,title.ilike.%omnibus%,title.ilike.%complete series%`
    );

  // Also catch "Books 1-3" patterns with a separate regex query
  const { data: bundleBooks } = await supabase
    .from("books")
    .select("id, title")
    .filter("title", "match", "(?i)books?\\s+\\d+\\s*[-–&]\\s*\\d+");

  // Also catch "Series by Author" entries (Goodreads series pages, not books)
  const { data: seriesPages } = await supabase
    .from("books")
    .select("id, title")
    .like("title", "% Series by %");

  const compilations = [
    ...(boxSets ?? []),
    ...(bundleBooks ?? []),
    ...(seriesPages ?? []),
  ];
  const seenIds = new Set<string>();

  for (const book of compilations) {
    if (seenIds.has(book.id)) continue;
    seenIds.add(book.id);

    const userData = await hasUserData(supabase, book.id);
    if (userData.hotlists > 0 || userData.ratings > 0) {
      result.skippedWithUserData.push(
        `${book.title} (${userData.hotlists} hotlists, ${userData.ratings} ratings)`
      );
      continue;
    }

    await deleteJunkBook(supabase, book.id, null);
    result.deleted++;
    result.details.push(`[compilation/box set] ${book.title}`);
  }

  // Phase 4: Scanner-flagged non-romance books
  // The Haiku quality scanner identifies books that aren't romance by reading
  // their synopsis/description. If it flagged a book as "wrong_book", it's a
  // non-romance entry that slipped through discovery channels. SQL patterns
  // can't catch these (titles are structurally normal), so we trust the scanner.
  const { data: scannerFlagged } = await supabase
    .from("quality_flags")
    .select("book_id, original_value")
    .eq("source", "haiku_scanner")
    .eq("issue_type", "wrong_book")
    .eq("status", "open");

  if (scannerFlagged) {
    // Deduplicate book IDs (a book could have multiple flags)
    const flaggedBookIds = Array.from(new Set(scannerFlagged.map((f: { book_id: string }) => f.book_id)));

    for (const bookId of flaggedBookIds) {
      // Skip if already deleted in earlier phases
      const { data: bookExists } = await supabase
        .from("books")
        .select("id, title, author")
        .eq("id", bookId)
        .single();

      if (!bookExists) continue;

      const userData = await hasUserData(supabase, bookId);
      if (userData.hotlists > 0 || userData.ratings > 0) {
        result.skippedWithUserData.push(
          `${bookExists.title} (${userData.hotlists} hotlists, ${userData.ratings} ratings) [scanner-flagged]`
        );
        continue;
      }

      await deleteJunkBook(supabase, bookId, null);
      result.deleted++;
      result.details.push(`[scanner: wrong_book] ${bookExists.title} by ${bookExists.author}`);
    }
  }

  // Phase 5: Duplicate book detection
  // Finds exact title+author pairs (case-insensitive) with multiple entries.
  // Scores each copy on data richness, keeps the canonical one, deletes the rest.
  // Migrates user data (hotlists, ratings) to the canonical copy before deletion.
  const { data: dupeGroups } = await supabase.rpc("find_duplicate_books");

  // Fallback: if the RPC doesn't exist yet, use a raw query approach
  if (dupeGroups === null) {
    // RPC not deployed yet — skip Phase 5
    result.details.push("[dupe-detection] Skipped — find_duplicate_books RPC not deployed");
  } else if (dupeGroups.length > 0) {
    for (const group of dupeGroups) {
      const bookIds: string[] = group.book_ids;
      if (bookIds.length < 2) continue;

      // Fetch full data for all copies in this group
      const { data: copies } = await supabase
        .from("books")
        .select("id, title, author, goodreads_id, enrichment_status, cover_url, ai_synopsis")
        .in("id", bookIds);

      if (!copies || copies.length < 2) continue;

      // Score each copy on data richness
      const scored = await Promise.all(
        copies.map(async (book) => {
          const [{ count: ratingCount }, { count: spiceCount }, userData] = await Promise.all([
            supabase.from("book_ratings").select("*", { count: "exact", head: true }).eq("book_id", book.id),
            supabase.from("spice_signals").select("*", { count: "exact", head: true }).eq("book_id", book.id),
            hasUserData(supabase, book.id),
          ]);

          let score = 0;
          if (book.goodreads_id) score += 3;
          if (book.enrichment_status === "complete") score += 2;
          if (book.cover_url) score += 2;
          if (book.ai_synopsis) score += 2;
          score += (ratingCount ?? 0);
          score += (spiceCount ?? 0);
          // User data is a strong signal — keep the copy users interact with
          if (userData.hotlists > 0) score += 5;
          if (userData.ratings > 0) score += 5;

          return { ...book, score, userData };
        })
      );

      // Sort by score descending — first entry is the canonical copy
      scored.sort((a, b) => b.score - a.score);
      const canonical = scored[0];
      const dupes = scored.slice(1);

      for (const dupe of dupes) {
        const { migrated } = await deleteJunkBook(supabase, dupe.id, canonical.id);
        result.deleted++;
        if (migrated) result.migrated++;
        result.details.push(
          `[dupe] "${dupe.title}" (GR:${dupe.goodreads_id ?? "none"}, score:${dupe.score}) → kept (GR:${canonical.goodreads_id ?? "none"}, score:${canonical.score})`
        );
      }
    }
  }

  return result;
}
