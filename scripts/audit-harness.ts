/**
 * HOTLIST AUDIT HARNESS (Prompt 18.2)
 *
 * Playwright-based audit script that navigates myhotlist.app production pages,
 * checks books and authors against a quality rubric, uses Haiku for visual
 * checks where needed, and writes findings to JSON + optionally to quality_flags.
 *
 * Usage:
 *   npx tsx scripts/audit-harness.ts                  # full run (~2 hours)
 *   npx tsx scripts/audit-harness.ts --quick           # top 20 books + all authors (~15 min)
 *   npx tsx scripts/audit-harness.ts --books-only      # skip author checks
 *   npx tsx scripts/audit-harness.ts --authors-only    # skip book checks
 *   npx tsx scripts/audit-harness.ts --category=dark_romance
 *   npx tsx scripts/audit-harness.ts --no-haiku        # skip visual checks
 *   npx tsx scripts/audit-harness.ts --push-to-db      # write P0/P1 flags to quality_flags
 *   npx tsx scripts/audit-harness.ts --full-catalog    # all DB books, structural checks only (~8h overnight)
 *   npx tsx scripts/audit-harness.ts --full-catalog --haiku-on-fail  # + Haiku for failures
 *   npx tsx scripts/audit-harness.ts --full-catalog --resume         # resume interrupted run
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { chromium, Browser, Page } from "playwright";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CorpusBook {
  title: string;
  author: string;
  category:
    | "romantasy"
    | "contemporary_romance"
    | "vampire_romance"
    | "shifter_wolf_romance"
    | "dark_romance"
    | "extended_romantasy"
    | "full_catalog";
  gr_rating_ground_truth: number | null;
  id?: string; // present in full-catalog mode
}

type Severity = "P0" | "P1" | "P2" | "P3";

interface CheckResult {
  check: string;
  passed: boolean;
  severity: Severity;
  detail: string;
  suggestedFix?: string;
}

interface BookFinding {
  type: "book";
  bookId: string | null;
  title: string;
  author: string;
  category: string;
  searchQuery: string;
  url: string | null;
  checks: CheckResult[];
  screenshotPath: string | null;
  issueCount: number;
  worstSeverity: Severity | null;
}

interface AuthorFinding {
  type: "author";
  author: string;
  url: string | null;
  checks: CheckResult[];
  resultCount: number;
  screenshotPath: string | null;
  issueCount: number;
  worstSeverity: Severity | null;
}

interface AuditReport {
  runAt: string;
  mode: string;
  baseUrl: string;
  summary: {
    booksChecked: number;
    authorsChecked: number;
    totalIssues: number;
    byCategory: Record<string, number>;
    bySeverity: Record<Severity, number>;
    passRate: number;
  };
  knownBugVerification: KnownBugResult[];
  findings: (BookFinding | AuthorFinding)[];
}

interface KnownBugResult {
  bugId: string;
  description: string;
  priority: string;
  stillPresent: boolean | null;
  detail: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = "https://myhotlist.app";
const SCREENSHOT_DIR = path.join(__dirname, "audit-reports", "screenshots");
const REPORTS_DIR = path.join(__dirname, "audit-reports");

// Author catalog floors — minimum books expected in search results.
const AUTHOR_CATALOG_FLOORS: Record<string, number> = {
  "Sarah J. Maas": 20,
  "Jennifer L. Armentrout": 15,
  "Rebecca Yarros": 8,
  "Kerri Maniscalco": 6,
  "Scarlett St. Clair": 8,
  "Raven Kennedy": 6,
  "Carissa Broadbent": 6,
  "L.J. Andrews": 8,
  "Danielle L. Jensen": 6,
  "Colleen Hoover": 10,
  "Emily Henry": 5,
  "Ana Huang": 6,
  "Holly Black": 6,
  "Penn Cole": 4,
  "Ali Hazelwood": 5,
  "Tracy Wolff": 6,
};

function getAuthorFloor(author: string): number {
  return AUTHOR_CATALOG_FLOORS[author] ?? 3;
}

// Category-based spice plausibility ranges: [min, max] acceptable.
const CATEGORY_SPICE_RANGE: Record<string, [number, number]> = {
  romantasy: [1, 5],
  extended_romantasy: [1, 5],
  vampire_romance: [2, 5],
  shifter_wolf_romance: [2, 5],
  dark_romance: [3, 5],
  contemporary_romance: [1, 5],
};

// Cover aspect ratio: height/width < this = likely audiobook.
const AUDIOBOOK_RATIO_THRESHOLD = 1.15;

// Rating accuracy tolerance.
const RATING_TOLERANCE = 0.3;

// Haiku model for visual checks.
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// Junk title patterns (from CLAUDE.md data-hygiene + 18.0 rules).
const JUNK_TITLE_PATTERNS = [
  /\[By:\s*.+?\]/i,
  /\[AudioCD\s*\(\d{4}\)\]/i,
  /\[(Paperback|Hardcover|Mass Market Paperback|Board Book)\]/i,
  /^Summary of\b/i,
  /\b(SparkNotes|CliffsNotes|BookCaps|StudySync)\b/i,
  /\bBooks?\s+\d+[-–]\d+\b/i,
  /\b(Complete Series|Box Set|Omnibus|Collection)\b/i,
  /Series by\s+/i,
];

// Series name junk patterns (from 18.0 rules engine).
const JUNK_SERIES_PATTERNS = [
  /^(Kindle Edition|Large Print|Large Print Edition|Unabridged|Abridged|Audio CD|Audiobook|Hardcover|Paperback|Mass Market Paperback|Board Book)$/i,
  /Large Print|Kindle Edition|Special Edition|Collector's Edition|Anniversary Edition|Illustrated Edition/i,
  /^(romance|love|passion|heat|fire|desire)\s+(collection|series|bundle|library|anthology)/i,
  /^(Complete Series|Box Set|Complete Collection|The Complete Series)$/i,
  /^Book\s+\d+\s+of\s+\d+$/i,
  /^(Standalone|Stand-alone)$/i,
  /^\d+$/,
];

// ── Haiku Visual Check ────────────────────────────────────────────────────────

async function haikuVisualCheck(
  client: Anthropic,
  screenshotBase64: string,
  context: { title: string; author: string; category: string }
): Promise<{
  coverPresent: boolean;
  coverIsAudiobook: boolean;
  enrichmentStalled: boolean;
  hasVisibleLayoutBreak: boolean;
  seriesNameSuspect: boolean;
  synopsisQuality: "good" | "short" | "placeholder" | "missing";
  notes: string;
}> {
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: screenshotBase64,
            },
          },
          {
            type: "text",
            text: `You are auditing a romance book discovery app page for quality issues.

Book: "${context.title}" by ${context.author} (category: ${context.category})

Check the screenshot and respond ONLY with a JSON object (no markdown):
{
  "coverPresent": true/false,
  "coverIsAudiobook": true/false,
  "enrichmentStalled": true/false,
  "hasVisibleLayoutBreak": true/false,
  "seriesNameSuspect": true/false,
  "synopsisQuality": "good" | "short" | "placeholder" | "missing",
  "notes": "brief note about any issues found, or 'clean' if none"
}`,
          },
        ],
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return {
      coverPresent: true,
      coverIsAudiobook: false,
      enrichmentStalled: false,
      hasVisibleLayoutBreak: false,
      seriesNameSuspect: false,
      synopsisQuality: "good",
      notes: "parse error",
    };
  }
}

// ── Book Page Checks ──────────────────────────────────────────────────────────

async function checkBookPage(
  page: Page,
  anthropic: Anthropic | null,
  book: CorpusBook,
  opts: { screenshotDir: string; useHaiku: boolean }
): Promise<BookFinding> {
  const checks: CheckResult[] = [];
  let pageUrl: string | null = null;
  let screenshotPath: string | null = null;

  // ── Step 1: Search for the book ──────────────────────────────────────────
  await page.goto(
    `${BASE_URL}/search?q=${encodeURIComponent(book.title + " " + book.author)}`,
    { waitUntil: "domcontentloaded", timeout: 15000 }
  );
  // Wait for book cards to render
  await page
    .waitForSelector('a[href*="/book/"]', { timeout: 8000 })
    .catch(() => null);

  // Find book links — scan all results, pick the best match.
  // Junk entries (e.g., "Bride - Ali Hazelwood" with Unknown Author) often rank
  // above the canonical book, so we prefer results that:
  //   1. Match the title
  //   2. Don't contain "Unknown Author"
  //   3. Don't have "by-" junk slug patterns
  //   4. Have a Goodreads-sourced slug (numeric ID suffix)
  const bookLinks = await page.locator('a[href*="/book/"]').all();

  let foundCorrectBook = false;
  let bookDetailUrl: string | null = null;

  if (bookLinks.length > 0) {
    const titleNorm = book.title
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "");
    const titleWords = titleNorm.split(" ").slice(0, 3).join(" ");
    const authorNorm = book.author
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "");

    // Score each result and pick the best
    let bestScore = -1;
    let bestHref: string | null = null;

    for (const link of bookLinks) {
      const text = ((await link.textContent()) ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "");
      const href = (await link.getAttribute("href")) ?? "";

      if (!text.includes(titleWords)) continue; // must match title

      let score = 1;
      // Prefer results that include the author name
      if (text.includes(authorNorm.split(" ").slice(-1)[0])) score += 2;
      // Penalize "Unknown Author" entries (junk dupes)
      if (text.includes("unknown author")) score -= 3;
      // Penalize slugs with "by-" pattern (scraping artifacts like "bride-ali-hazelwood")
      if (href.includes("-by-")) score -= 1;
      // Prefer slugs with Goodreads numeric IDs (e.g., /book/fourth-wing-61767292)
      if (/\/book\/[\w-]+-\d{5,}$/.test(href)) score += 1;
      // Penalize provisional entries
      if (href.includes("provisional-")) score -= 2;
      // Prefer results with rating data visible
      if (text.includes("gr ") || text.includes("amz ")) score += 1;

      if (score > bestScore) {
        bestScore = score;
        bestHref = href;
      }
    }

    if (bestHref) {
      foundCorrectBook = true;
      bookDetailUrl = bestHref.startsWith("http") ? bestHref : BASE_URL + bestHref;
    }
  }

  if (!foundCorrectBook || !bookDetailUrl) {
    checks.push({
      check: "book_found",
      passed: false,
      severity: "P0",
      detail: `Book not found in search results: "${book.title}" by ${book.author}`,
      suggestedFix: "Trigger enrichment or add to discovery queue",
    });
    return buildFinding("book", book, null, checks, null);
  }

  checks.push({
    check: "book_found",
    passed: true,
    severity: "P3",
    detail: "Found in search results",
  });
  pageUrl = bookDetailUrl;

  // ── Step 2: Navigate to book detail page ────────────────────────────────
  await page.goto(bookDetailUrl, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  // Wait for the title h1 to render
  await page.waitForSelector("h1", { timeout: 8000 }).catch(() => null);

  // ── Step 3: Cover art checks ─────────────────────────────────────────────
  const coverImg = page
    .locator('img[alt*="Cover of"]')
    .first();
  const coverVisible = await coverImg.isVisible().catch(() => false);

  if (!coverVisible) {
    checks.push({
      check: "cover_present",
      passed: false,
      severity: "P0",
      detail: "Cover image is missing or not visible",
      suggestedFix: "Check cover_url field and Google Books fallback",
    });
  } else {
    checks.push({
      check: "cover_present",
      passed: true,
      severity: "P3",
      detail: "Cover image visible",
    });

    // Check aspect ratio for audiobook detection
    const box = await coverImg.boundingBox();
    if (box) {
      const ratio = box.height / box.width;
      if (ratio < AUDIOBOOK_RATIO_THRESHOLD) {
        checks.push({
          check: "cover_portrait",
          passed: false,
          severity: "P1",
          detail: `Cover aspect ratio is ${ratio.toFixed(2)} (< ${AUDIOBOOK_RATIO_THRESHOLD}) — may be audiobook edition`,
          suggestedFix:
            "Verify edition: may need cover_url from correct Goodreads ID",
        });
      } else {
        checks.push({
          check: "cover_portrait",
          passed: true,
          severity: "P3",
          detail: `Cover ratio ${ratio.toFixed(2)} — portrait OK`,
        });
      }
    }
  }

  // ── Step 4: Enrichment stall check ───────────────────────────────────────
  const bodyText = (await page.locator("body").textContent()) ?? "";
  const fetchingMatches = (bodyText.match(/fetching/gi) ?? []).length;
  const skeletonCount = await page
    .locator('[class*="skeleton"], [class*="Skeleton"]')
    .count();
  const enrichmentBanner = await page
    .locator('text=/being enriched/i, text=/gathering data/i')
    .count();

  if (fetchingMatches > 2 || skeletonCount > 3 || enrichmentBanner > 0) {
    checks.push({
      check: "enrichment_complete",
      passed: false,
      severity: "P0",
      detail: `Page shows ${fetchingMatches} "fetching" instances, ${skeletonCount} skeletons, ${enrichmentBanner} enrichment banners — data may be stalled`,
      suggestedFix: "Check enrichment_queue for stuck jobs on this book_id",
    });
  } else {
    checks.push({
      check: "enrichment_complete",
      passed: true,
      severity: "P3",
      detail: "No enrichment stall indicators",
    });
  }

  // ── Step 5: Goodreads rating check ───────────────────────────────────────
  // The RatingBadge renders as: <span aria-label="Goodreads rating: 4.23">
  // with the number in a child <span class="font-bold">4.23</span>
  // and the label in <span class="uppercase">Goodreads</span>.
  // In body text this appears as "Goodreads4.23" (no space) or "Goodreads 4.23".
  // Also check aria-labels for "Goodreads rating: X.XX" pattern.
  // RatingBadge renders score ABOVE the label, so body text reads "4.23Goodreads"
  // (number before label). Also check the reverse and aria-label patterns.
  const grAriaMatch = bodyText.match(/Goodreads rating:\s*(\d\.\d{1,2})/);
  const grAfterMatch = bodyText.match(/Goodreads\s*([2345]\.\d{1,2})/);
  const grBeforeMatch = bodyText.match(/([2345]\.\d{1,2})\s*Goodreads/);
  const grDisplayed = grAriaMatch
    ? parseFloat(grAriaMatch[1])
    : grAfterMatch
      ? parseFloat(grAfterMatch[1])
      : grBeforeMatch
        ? parseFloat(grBeforeMatch[1])
        : null;

  if (!grDisplayed) {
    checks.push({
      check: "goodreads_rating_present",
      passed: false,
      severity: "P1",
      detail: "Goodreads rating not found on page",
      suggestedFix: "Check goodreads enrichment job status",
    });
  } else {
    checks.push({
      check: "goodreads_rating_present",
      passed: true,
      severity: "P3",
      detail: `GR rating: ${grDisplayed}`,
    });

    // Ground truth accuracy check
    if (book.gr_rating_ground_truth !== null) {
      const diff = Math.abs(grDisplayed - book.gr_rating_ground_truth);
      if (diff > RATING_TOLERANCE) {
        checks.push({
          check: "rating_accuracy",
          passed: false,
          severity: "P1",
          detail: `GR rating ${grDisplayed} differs from ground truth ${book.gr_rating_ground_truth} by ${diff.toFixed(2)} (tolerance: ${RATING_TOLERANCE})`,
          suggestedFix:
            "May be wrong Goodreads edition — check goodreads_id in DB",
        });
      } else {
        checks.push({
          check: "rating_accuracy",
          passed: true,
          severity: "P3",
          detail: `Rating ${grDisplayed} within tolerance of GT ${book.gr_rating_ground_truth}`,
        });
      }
    }
  }

  // ── Step 6: Spice level check ────────────────────────────────────────────
  // SpiceDisplay uses pepper emoji with opacity classes
  const pepperSpans = await page
    .locator('span[role="img"][aria-label*="Spice level"]')
    .count();
  const hasPepperEmoji = bodyText.includes("\u{1F336}"); // 🌶️

  if (!pepperSpans && !hasPepperEmoji) {
    checks.push({
      check: "spice_present",
      passed: false,
      severity: "P1",
      detail: "No spice indicator found on page",
      suggestedFix: "Check spice_signals table for this book_id",
    });
  } else {
    checks.push({
      check: "spice_present",
      passed: true,
      severity: "P3",
      detail: "Spice indicator present",
    });

    // Category-based spice plausibility check using all ranges
    const spiceLabelMatch = bodyText.match(
      /Spice level (\d(?:\.\d)?) of 5/
    );
    if (spiceLabelMatch) {
      const spiceLevel = parseFloat(spiceLabelMatch[1]);
      const range = CATEGORY_SPICE_RANGE[book.category];
      if (range && (spiceLevel < range[0] || spiceLevel > range[1])) {
        checks.push({
          check: "spice_plausible",
          passed: false,
          severity: "P2",
          detail: `${book.category} book shows spice ${spiceLevel}/5 — expected range [${range[0]}, ${range[1]}]`,
          suggestedFix:
            "Review spice source; may be wrong edition or mislabeled",
        });
      } else if (range) {
        checks.push({
          check: "spice_plausible",
          passed: true,
          severity: "P3",
          detail: `Spice ${spiceLevel} within range for ${book.category}`,
        });
      }
    }
  }

  // ── Step 7: Synopsis check ────────────────────────────────────────────────
  // "About this book" heading marks the synopsis section
  const synopsisHeading = page.locator('text="About this book"').first();
  const hasSynopsisSection =
    (await synopsisHeading.isVisible().catch(() => false));

  let synopsisText = "";
  if (hasSynopsisSection) {
    // Get the text in the parent container after the heading
    const synopsisContainer = synopsisHeading.locator("xpath=..");
    synopsisText = ((await synopsisContainer.textContent()) ?? "")
      .replace(/About this book/i, "")
      .trim();
  }

  if (!synopsisText || synopsisText.length < 60) {
    // Also check for the "no synopsis" fallback
    const noSynopsis = await page
      .locator("text=/No synopsis available/i")
      .count();
    checks.push({
      check: "synopsis_present",
      passed: false,
      severity: "P2",
      detail:
        noSynopsis > 0
          ? 'Synopsis shows "No synopsis available" placeholder'
          : `Synopsis missing or too short (${synopsisText.length} chars)`,
      suggestedFix: "Check ai_synopsis field; may need re-generation",
    });
  } else {
    const placeholderPatterns = [
      "synopsis not available",
      "no synopsis",
      "coming soon",
      "n/a",
      "tbd",
    ];
    const isPlaceholder = placeholderPatterns.some((p) =>
      synopsisText.toLowerCase().includes(p)
    );
    if (isPlaceholder) {
      checks.push({
        check: "synopsis_present",
        passed: false,
        severity: "P2",
        detail: `Synopsis is a placeholder: "${synopsisText.substring(0, 80)}"`,
        suggestedFix: "Queue ai_synopsis job for this book",
      });
    } else {
      checks.push({
        check: "synopsis_present",
        passed: true,
        severity: "P3",
        detail: `Synopsis present (${synopsisText.length} chars)`,
      });
    }
  }

  // ── Step 8: Series name check ─────────────────────────────────────────────
  // Series shows as "· Series Name #Position" after author
  const seriesMatch = bodyText.match(/·\s+(.+?)\s+#\d+/);
  const seriesName = seriesMatch ? seriesMatch[1].trim() : null;

  if (seriesName) {
    const isJunkSeries = JUNK_SERIES_PATTERNS.some((p) => p.test(seriesName));
    if (isJunkSeries) {
      checks.push({
        check: "series_name_sane",
        passed: false,
        severity: "P1",
        detail: `Series name looks like junk data: "${seriesName}"`,
        suggestedFix: "Clear series_name field via quality_flags auto-fix",
      });
    } else {
      checks.push({
        check: "series_name_sane",
        passed: true,
        severity: "P3",
        detail: `Series name OK: "${seriesName}"`,
      });
    }
  }

  // ── Step 9: Title junk check ──────────────────────────────────────────────
  const titleEl = page.locator("h1").first();
  const displayedTitle = ((await titleEl.textContent()) ?? "").trim();

  const isTitleJunk = JUNK_TITLE_PATTERNS.some((p) => p.test(displayedTitle));
  if (isTitleJunk) {
    checks.push({
      check: "title_clean",
      passed: false,
      severity: "P0",
      detail: `Title appears to be junk/artifact: "${displayedTitle}"`,
      suggestedFix: "Remove this entry — likely a scraping artifact",
    });
  }

  // ── Step 10: Foreign edition check ───────────────────────────────────────
  const nonLatinPattern = /[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\u0600-\u06FF]/;
  if (nonLatinPattern.test(displayedTitle)) {
    checks.push({
      check: "no_foreign_edition",
      passed: false,
      severity: "P1",
      detail: `Book title contains non-Latin characters: "${displayedTitle}" — may be wrong edition`,
      suggestedFix:
        "Check Goodreads ID — may be resolving to foreign language edition",
    });
  }

  // ── Step 11: Haiku visual check (on failures or borderline cases) ─────────
  const hasFailures = checks.some(
    (c) => !c.passed && ["P0", "P1"].includes(c.severity)
  );
  const coverBorderline = checks.find(
    (c) => c.check === "cover_portrait" && !c.passed
  );

  if (opts.useHaiku && anthropic && (hasFailures || coverBorderline)) {
    try {
      const screenshot = await page.screenshot({
        type: "png",
        fullPage: false,
      });
      const base64 = screenshot.toString("base64");

      const ts = Date.now();
      const safeName = book.title
        .replace(/[^a-zA-Z0-9]/g, "_")
        .substring(0, 40);
      screenshotPath = path.join(
        opts.screenshotDir,
        `${safeName}_${ts}.png`
      );
      fs.writeFileSync(screenshotPath, screenshot);

      const visual = await haikuVisualCheck(anthropic, base64, {
        title: book.title,
        author: book.author,
        category: book.category,
      });

      if (
        visual.enrichmentStalled &&
        !checks.find((c) => c.check === "enrichment_complete" && !c.passed)
      ) {
        checks.push({
          check: "enrichment_complete",
          passed: false,
          severity: "P0",
          detail: `Haiku visual check: enrichment stall detected. ${visual.notes}`,
          suggestedFix: "Check enrichment_queue for stuck jobs",
        });
      }

      if (visual.hasVisibleLayoutBreak) {
        checks.push({
          check: "layout_intact",
          passed: false,
          severity: "P1",
          detail: `Haiku visual check: layout issue detected. ${visual.notes}`,
        });
      }

      if (
        visual.seriesNameSuspect &&
        !checks.find((c) => c.check === "series_name_sane" && !c.passed)
      ) {
        checks.push({
          check: "series_name_sane",
          passed: false,
          severity: "P1",
          detail: `Haiku visual check: series name looks suspect. ${visual.notes}`,
          suggestedFix: "Review series_name field",
        });
      }

      if (visual.synopsisQuality !== "good") {
        const existing = checks.find((c) => c.check === "synopsis_present");
        if (!existing || existing.passed) {
          checks.push({
            check: "synopsis_present",
            passed: false,
            severity: "P2",
            detail: `Haiku visual check: synopsis quality is "${visual.synopsisQuality}". ${visual.notes}`,
          });
        }
      }
    } catch (err) {
      console.warn(
        `  [haiku] Visual check failed for "${book.title}":`,
        err
      );
    }
  }

  return buildFinding("book", book, pageUrl, checks, screenshotPath);
}

// ── Author Search Checks ──────────────────────────────────────────────────────

async function checkAuthorSearch(
  page: Page,
  author: string,
  opts: { screenshotDir: string }
): Promise<AuthorFinding> {
  const checks: CheckResult[] = [];
  let screenshotPath: string | null = null;
  let resultCount = 0;

  await page.goto(
    `${BASE_URL}/search?q=${encodeURIComponent(author)}`,
    { waitUntil: "domcontentloaded", timeout: 15000 }
  );
  await page
    .waitForSelector('a[href*="/book/"]', { timeout: 8000 })
    .catch(() => null);

  const cards = await page.locator('a[href*="/book/"]').all();
  resultCount = cards.length;

  const floor = getAuthorFloor(author);

  if (resultCount === 0) {
    checks.push({
      check: "author_found",
      passed: false,
      severity: "P0",
      detail: `No results at all for author "${author}"`,
      suggestedFix: "Trigger author_crawl enrichment job",
    });
    return buildAuthorFinding(author, null, checks, resultCount, null);
  }

  checks.push({
    check: "author_found",
    passed: true,
    severity: "P3",
    detail: `Found ${resultCount} results`,
  });

  if (resultCount < floor) {
    checks.push({
      check: "result_count",
      passed: false,
      severity: "P0",
      detail: `Only ${resultCount} books returned for "${author}" (expected >= ${floor}). Note: search may paginate — check DB count too`,
      suggestedFix:
        "Trigger author_crawl to expand catalog; check pagination limit",
    });
  } else {
    checks.push({
      check: "result_count",
      passed: true,
      severity: "P3",
      detail: `${resultCount} results >= floor ${floor}`,
    });
  }

  // Scan visible titles for foreign edition contamination
  const allTitles = await page
    .locator('a[href*="/book/"]')
    .allTextContents();

  const nonLatinPattern = /[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\u0600-\u06FF]/;
  const foreignTitles = allTitles.filter((t) => nonLatinPattern.test(t));
  if (foreignTitles.length > 0) {
    checks.push({
      check: "no_foreign_editions",
      passed: false,
      severity: "P1",
      detail: `${foreignTitles.length} foreign language titles in results: ${foreignTitles.slice(0, 3).join(", ")}`,
      suggestedFix: "Add language filter to author search results",
    });
  } else {
    checks.push({
      check: "no_foreign_editions",
      passed: true,
      severity: "P3",
      detail: "No foreign editions detected",
    });
  }

  // Scan for junk entries (compilations, box sets)
  const junkTitles = allTitles.filter((t) =>
    JUNK_TITLE_PATTERNS.some((p) => p.test(t))
  );
  if (junkTitles.length > 0) {
    checks.push({
      check: "no_junk_entries",
      passed: false,
      severity: "P1",
      detail: `${junkTitles.length} junk entries in results: ${junkTitles.slice(0, 3).join(", ")}`,
      suggestedFix:
        "data-hygiene cron should catch these; check isCompilationTitle() filter",
    });
  } else {
    checks.push({
      check: "no_junk_entries",
      passed: true,
      severity: "P3",
      detail: "No junk entries detected",
    });
  }

  // Screenshot if issues found
  const hasIssues = checks.some((c) => !c.passed);
  if (hasIssues) {
    const screenshot = await page.screenshot({ type: "png", fullPage: false });
    const safeName = author
      .replace(/[^a-zA-Z0-9]/g, "_")
      .substring(0, 40);
    screenshotPath = path.join(
      opts.screenshotDir,
      `author_${safeName}_${Date.now()}.png`
    );
    fs.writeFileSync(screenshotPath, screenshot);
  }

  const url = page.url();
  return buildAuthorFinding(author, url, checks, resultCount, screenshotPath);
}

// ── Known Bug Verification ────────────────────────────────────────────────────

async function verifyKnownBugs(page: Page): Promise<KnownBugResult[]> {
  const results: KnownBugResult[] = [];

  // BUG-001: P0 — Spice below the fold on book detail
  try {
    await page.goto(`${BASE_URL}/book/fourth-wing`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForSelector("h1", { timeout: 8000 }).catch(() => null);
    const spiceEl = page
      .locator('span[role="img"][aria-label*="Spice level"]')
      .first();
    const spiceBox = await spiceEl.boundingBox().catch(() => null);
    const viewport = page.viewportSize();
    const spiceBelowFold = spiceBox
      ? spiceBox.y > (viewport?.height ?? 800)
      : true;
    results.push({
      bugId: "BUG-001",
      description: "Book detail: spice section is below the fold",
      priority: "P0",
      stillPresent: spiceBelowFold,
      detail: spiceBox
        ? `Spice element y=${spiceBox.y.toFixed(0)}, viewport h=${viewport?.height}`
        : "Spice element not found",
    });
  } catch (err) {
    results.push({
      bugId: "BUG-001",
      description: "Book detail: spice section is below the fold",
      priority: "P0",
      stillPresent: null,
      detail: `Error: ${err}`,
    });
  }

  // BUG-002: P0 — Throne of Glass wrong cover / audiobook
  try {
    await page.goto(
      `${BASE_URL}/search?q=Throne+of+Glass+Sarah+J+Maas`,
      { waitUntil: "domcontentloaded", timeout: 15000 }
    );
    await page
      .waitForSelector('a[href*="/book/"]', { timeout: 8000 })
      .catch(() => null);
    const togLink = page.locator('a[href*="throne-of-glass"]').first();
    const togHref = await togLink.getAttribute("href").catch(() => null);
    if (togHref) {
      await page.goto(
        togHref.startsWith("http") ? togHref : BASE_URL + togHref,
        { waitUntil: "domcontentloaded", timeout: 20000 }
      );
      await page.waitForSelector('img[alt*="Cover of"]', { timeout: 8000 }).catch(() => null);
      const togCover = page.locator('img[alt*="Cover of"]').first();
      const togBox = await togCover.boundingBox().catch(() => null);
      const togIsSquare = togBox
        ? togBox.height / togBox.width < AUDIOBOOK_RATIO_THRESHOLD
        : false;
      results.push({
        bugId: "BUG-002",
        description: "Throne of Glass: wrong cover art / audiobook edition",
        priority: "P0",
        stillPresent: togIsSquare,
        detail: togBox
          ? `Cover ratio h/w = ${(togBox.height / togBox.width).toFixed(2)}`
          : "Cover not found",
      });
    } else {
      results.push({
        bugId: "BUG-002",
        description: "Throne of Glass: wrong cover art / audiobook edition",
        priority: "P0",
        stillPresent: null,
        detail: "Could not find Throne of Glass book page",
      });
    }
  } catch (err) {
    results.push({
      bugId: "BUG-002",
      description: "Throne of Glass: wrong cover art / audiobook edition",
      priority: "P0",
      stillPresent: null,
      detail: `Error: ${err}`,
    });
  }

  // BUG-003: P0 — "fetching" enrichment details stall
  try {
    await page.goto(`${BASE_URL}/book/fourth-wing`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForSelector("h1", { timeout: 8000 }).catch(() => null);
    const bodyText = (await page.locator("body").textContent()) ?? "";
    const fetchingCount = (bodyText.match(/fetching/gi) ?? []).length;
    results.push({
      bugId: "BUG-003",
      description: 'Shows "fetching" enrichment details indefinitely',
      priority: "P0",
      stillPresent: fetchingCount > 0,
      detail: `Found ${fetchingCount} "fetching" text instances`,
    });
  } catch (err) {
    results.push({
      bugId: "BUG-003",
      description: 'Shows "fetching" enrichment details indefinitely',
      priority: "P0",
      stillPresent: null,
      detail: `Error: ${err}`,
    });
  }

  // BUG-004: P0 — Bridge Kingdom missing enrichment
  try {
    await page.goto(
      `${BASE_URL}/search?q=Bridge+Kingdom+Danielle+L+Jensen`,
      { waitUntil: "domcontentloaded", timeout: 15000 }
    );
    await page
      .waitForSelector('a[href*="/book/"]', { timeout: 8000 })
      .catch(() => null);
    const bkLink = page.locator('a[href*="bridge-kingdom"]').first();
    const bkHref = await bkLink.getAttribute("href").catch(() => null);
    if (bkHref) {
      await page.goto(
        bkHref.startsWith("http") ? bkHref : BASE_URL + bkHref,
        { waitUntil: "domcontentloaded", timeout: 20000 }
      );
      await page.waitForSelector("h1", { timeout: 8000 }).catch(() => null);
      const allText = (await page.locator("body").textContent()) ?? "";
      const bkFetching = (allText.match(/fetching/gi) ?? []).length;
      const grMatch = allText.match(/Goodreads[^0-9]*([34]\.\d{1,2})/);
      results.push({
        bugId: "BUG-004",
        description: "Bridge Kingdom: missing enrichment + wrong GR data",
        priority: "P0",
        stillPresent: bkFetching > 0 || !grMatch,
        detail: `Fetching: ${bkFetching}, GR rating present: ${!!grMatch}`,
      });
    } else {
      results.push({
        bugId: "BUG-004",
        description: "Bridge Kingdom: missing enrichment + wrong GR data",
        priority: "P0",
        stillPresent: null,
        detail: "Could not find Bridge Kingdom book page",
      });
    }
  } catch (err) {
    results.push({
      bugId: "BUG-004",
      description: "Bridge Kingdom: missing enrichment + wrong GR data",
      priority: "P0",
      stillPresent: null,
      detail: `Error: ${err}`,
    });
  }

  // BUG-005: P1 — Throne of Glass search missing covers
  try {
    await page.goto(`${BASE_URL}/search?q=Throne+of+Glass`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page
      .waitForSelector('a[href*="/book/"]', { timeout: 8000 })
      .catch(() => null);
    const togCovers = await page
      .locator('a[href*="/book/"] img[alt*="Cover of"]')
      .all();
    const anyMissing = await Promise.all(
      togCovers.map(async (img) => {
        const src = await img.getAttribute("src");
        return !src || src.includes("placeholder") || src.includes("no-cover");
      })
    );
    results.push({
      bugId: "BUG-005",
      description: "Throne of Glass search results show no-cover result",
      priority: "P1",
      stillPresent: anyMissing.some(Boolean),
      detail: `${togCovers.length} results with covers, ${anyMissing.filter(Boolean).length} missing`,
    });
  } catch (err) {
    results.push({
      bugId: "BUG-005",
      description: "Throne of Glass search results show no-cover result",
      priority: "P1",
      stillPresent: null,
      detail: `Error: ${err}`,
    });
  }

  // BUG-006: P0 — SJM search limited to 12 results
  try {
    await page.goto(`${BASE_URL}/search?q=Sarah+J+Maas`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page
      .waitForSelector('a[href*="/book/"]', { timeout: 8000 })
      .catch(() => null);
    const sjmResults = await page.locator('a[href*="/book/"]').all();
    results.push({
      bugId: "BUG-006",
      description: "SJM author search: incomplete results (was limited to 12)",
      priority: "P0",
      stillPresent: sjmResults.length < 20,
      detail: `Found ${sjmResults.length} books (expected >= 20)`,
    });
  } catch (err) {
    results.push({
      bugId: "BUG-006",
      description: "SJM author search: incomplete results",
      priority: "P0",
      stillPresent: null,
      detail: `Error: ${err}`,
    });
  }

  // BUG-007: P1 — No Amazon review data for Alchemised
  try {
    await page.goto(`${BASE_URL}/search?q=Alchemised`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page
      .waitForSelector('a[href*="/book/"]', { timeout: 8000 })
      .catch(() => null);
    const alchLink = page.locator('a[href*="alchemi"]').first();
    const alchHref = await alchLink.getAttribute("href").catch(() => null);
    if (alchHref) {
      await page.goto(
        alchHref.startsWith("http") ? alchHref : BASE_URL + alchHref,
        { waitUntil: "domcontentloaded", timeout: 20000 }
      );
      await page.waitForSelector("h1", { timeout: 8000 }).catch(() => null);
      const allText = (await page.locator("body").textContent()) ?? "";
      const hasAmazon = allText.match(/[Aa]mazon[^0-9]*[45]\.\d/);
      results.push({
        bugId: "BUG-007",
        description: "Alchemised: no Amazon review data displayed",
        priority: "P1",
        stillPresent: !hasAmazon,
        detail: hasAmazon ? "Amazon rating found" : "No Amazon rating found",
      });
    } else {
      results.push({
        bugId: "BUG-007",
        description: "Alchemised: no Amazon review data",
        priority: "P1",
        stillPresent: null,
        detail: "Book not found in search",
      });
    }
  } catch (err) {
    results.push({
      bugId: "BUG-007",
      description: "Alchemised: no Amazon review data",
      priority: "P1",
      stillPresent: null,
      detail: `Error: ${err}`,
    });
  }

  // BUG-008: P0 — Fourth Wing foreign language results in search
  try {
    await page.goto(
      `${BASE_URL}/search?q=Fourth+Wing+Rebecca+Yarros`,
      { waitUntil: "domcontentloaded", timeout: 15000 }
    );
    await page
      .waitForSelector('a[href*="/book/"]', { timeout: 8000 })
      .catch(() => null);
    const allTitles = await page
      .locator('a[href*="/book/"]')
      .allTextContents();
    const nonLatin = /[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\u0600-\u06FF]/;
    const foreignResults = allTitles.filter((t) => nonLatin.test(t));
    results.push({
      bugId: "BUG-008",
      description: "Fourth Wing search returns foreign language editions",
      priority: "P0",
      stillPresent: foreignResults.length > 0,
      detail:
        foreignResults.length > 0
          ? `Foreign results: ${foreignResults.join(", ")}`
          : "No foreign results found",
    });
  } catch (err) {
    results.push({
      bugId: "BUG-008",
      description: "Fourth Wing search returns foreign language editions",
      priority: "P0",
      stillPresent: null,
      detail: `Error: ${err}`,
    });
  }

  return results;
}

// ── Helper Functions ──────────────────────────────────────────────────────────

function buildFinding(
  _type: "book",
  book: CorpusBook,
  url: string | null,
  checks: CheckResult[],
  screenshotPath: string | null
): BookFinding {
  const failed = checks.filter((c) => !c.passed);
  const severityOrder: Severity[] = ["P0", "P1", "P2", "P3"];
  const worstSeverity =
    failed.length > 0
      ? severityOrder.find((s) => failed.some((c) => c.severity === s)) ?? null
      : null;
  return {
    type: "book",
    bookId: book.id ?? null,
    title: book.title,
    author: book.author,
    category: book.category,
    searchQuery: `${book.title} ${book.author}`,
    url,
    checks,
    screenshotPath,
    issueCount: failed.length,
    worstSeverity,
  };
}

function buildAuthorFinding(
  author: string,
  url: string | null,
  checks: CheckResult[],
  resultCount: number,
  screenshotPath: string | null
): AuthorFinding {
  const failed = checks.filter((c) => !c.passed);
  const severityOrder: Severity[] = ["P0", "P1", "P2", "P3"];
  const worstSeverity =
    failed.length > 0
      ? severityOrder.find((s) => failed.some((c) => c.severity === s)) ?? null
      : null;
  return {
    type: "author",
    author,
    url,
    checks,
    resultCount,
    screenshotPath,
    issueCount: failed.length,
    worstSeverity,
  };
}

function getSeverityRank(s: Severity | null): number {
  return s ? { P0: 0, P1: 1, P2: 2, P3: 3 }[s] : 4;
}

function checkToFieldName(check: string): string {
  const map: Record<string, string> = {
    cover_present: "cover_url",
    cover_portrait: "cover_url",
    goodreads_rating_present: "goodreads_id",
    rating_accuracy: "goodreads_id",
    spice_present: "spice_signals",
    spice_plausible: "spice_signals",
    synopsis_present: "ai_synopsis",
    series_name_sane: "series_name",
    title_clean: "title",
    no_foreign_edition: "title",
    enrichment_complete: "enrichment_status",
    layout_intact: "rendering",
  };
  return map[check] ?? check;
}

// ── DB Push ───────────────────────────────────────────────────────────────────

async function pushFindingsToDb(
  findings: (BookFinding | AuthorFinding)[]
) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let inserted = 0;
  let skipped = 0;

  for (const finding of findings) {
    if (finding.type !== "book" || !finding.url) continue;

    const bookFinding = finding as BookFinding;
    let bookId = bookFinding.bookId;

    // If we already have the ID (full-catalog mode), use it directly
    // Otherwise, look up by title + author
    if (!bookId) {
      const { data: book } = await supabase
        .from("books")
        .select("id")
        .ilike("title", bookFinding.title)
        .ilike("author", bookFinding.author)
        .limit(1)
        .single();
      if (!book) continue;
      bookId = book.id;
    }

    for (const check of finding.checks.filter(
      (c) => !c.passed && ["P0", "P1"].includes(c.severity)
    )) {
      // Skip if an open flag already exists for this book + field + issue
      const { data: existing } = await supabase
        .from("quality_flags")
        .select("id")
        .eq("book_id", bookId)
        .eq("field_name", checkToFieldName(check.check))
        .eq("issue_type", check.check)
        .eq("status", "open")
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      const { error: insertErr } = await supabase
        .from("quality_flags")
        .insert({
          book_id: bookId,
          field_name: checkToFieldName(check.check),
          issue_type: check.check,
          source: "browser_harness",
          priority: check.severity,
          confidence: check.severity === "P0" ? 0.95 : 0.8,
          original_value: check.detail.substring(0, 500),
          suggested_value: check.suggestedFix ?? null,
          auto_fixable: false,
          status: "open",
        });
      if (!insertErr) inserted++; // ignore unique constraint violations
    }
  }

  console.log(
    `   Inserted ${inserted} new quality flags (${skipped} skipped — already flagged)`
  );
}

// ── Full Catalog Loader ──────────────────────────────────────────────────────

const PROGRESS_FILE = path.join(__dirname, "audit-reports", "full-catalog-progress.json");

async function loadFullCatalog(resume: boolean): Promise<CorpusBook[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch all complete books from DB
  const { data: allBooks, error } = await supabase
    .from("books")
    .select("id, title, author")
    .eq("enrichment_status", "complete")
    .order("updated_at", { ascending: false });

  if (error || !allBooks) {
    throw new Error(`Failed to load books from DB: ${error?.message}`);
  }

  let books: CorpusBook[] = allBooks.map((b: { id: string; title: string; author: string }) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    category: "full_catalog" as const,
    gr_rating_ground_truth: null,
  }));

  // If resuming, skip books already audited in this run
  if (resume && fs.existsSync(PROGRESS_FILE)) {
    const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
    const completedIds = new Set<string>(progress.completedIds);
    const before = books.length;
    books = books.filter((b) => !completedIds.has(b.id!));
    console.log(`  Resuming: ${before - books.length} already done, ${books.length} remaining`);
  }

  return books;
}

function saveProgress(completedIds: string[]) {
  fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
    runDate: new Date().toISOString(),
    completedIds,
  }));
}

async function markBrowserAudited(bookIds: string[]) {
  if (bookIds.length === 0) return;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  // Update in batches of 100
  for (let i = 0; i < bookIds.length; i += 100) {
    const batch = bookIds.slice(i, i + 100);
    await supabase
      .from("books")
      .update({ last_browser_audit: new Date().toISOString() })
      .in("id", batch);
  }
}

// ── Main Orchestrator ─────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const isQuick = args.includes("--quick");
  const isFullCatalog = args.includes("--full-catalog");
  const booksOnly = args.includes("--books-only");
  const authorsOnly = args.includes("--authors-only");
  const categoryFilter = args
    .find((a) => a.startsWith("--category="))
    ?.split("=")[1];
  const resume = args.includes("--resume");
  const haikuOnFail = args.includes("--haiku-on-fail");
  // In full-catalog mode, default to no Haiku unless --haiku-on-fail is set.
  // In corpus mode, default to Haiku unless --no-haiku is set.
  const useHaiku = isFullCatalog ? haikuOnFail : !args.includes("--no-haiku");
  const pushToDb = args.includes("--push-to-db") || isFullCatalog; // always push in full-catalog

  const mode = isFullCatalog ? "full-catalog" : isQuick ? "quick" : "corpus";

  console.log("\nHotlist Audit Harness");
  console.log("========================================");
  console.log(
    `Mode: ${mode} | Haiku: ${useHaiku ? (haikuOnFail ? "on-fail-only" : "all") : "off"} | Push to DB: ${pushToDb}`
  );

  let books: CorpusBook[];
  let authors: string[];

  if (isFullCatalog) {
    // Full catalog mode: pull from DB, skip author checks
    books = await loadFullCatalog(resume);
    authors = [];
    console.log(`  Loaded ${books.length} books from database`);
  } else {
    // Corpus mode: load from JSON file
    const corpus = JSON.parse(
      fs.readFileSync(path.join(__dirname, "audit-corpus.json"), "utf8")
    );
    books = corpus.books;
    authors = corpus.authors;

    // Apply filters
    if (isQuick) {
      books = [
        ...books.filter((b) => b.category === "romantasy").slice(0, 12),
        ...books
          .filter((b) => b.category === "contemporary_romance")
          .slice(0, 8),
      ];
    }
    if (categoryFilter) {
      books = books.filter((b) => b.category === categoryFilter);
    }
  }

  if (authorsOnly) books = [];
  if (booksOnly) authors = [];

  console.log(
    `Books to check: ${books.length} | Authors to check: ${authors.length}`
  );
  const estSeconds = books.length * (isFullCatalog ? 5 : 8) + authors.length * 5;
  const estHours = estSeconds / 3600;
  console.log(
    `Estimated time: ${estHours >= 1 ? `~${estHours.toFixed(1)} hours` : `~${Math.ceil(estSeconds / 60)} minutes`}\n`
  );

  // Setup
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const anthropic =
    useHaiku && process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null;
  const browser: Browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14 Pro (mobile-first)

  const findings: (BookFinding | AuthorFinding)[] = [];

  // ── Known bug verification (skip in full-catalog mode) ───────────────────
  let knownBugResults: KnownBugResult[] = [];
  let stillOpenCount = 0;
  if (!isFullCatalog) {
    console.log("Verifying known open bugs...");
    knownBugResults = await verifyKnownBugs(page);
    stillOpenCount = knownBugResults.filter(
      (r) => r.stillPresent === true
    ).length;
    console.log(
      `  ${stillOpenCount}/${knownBugResults.length} known bugs still present\n`
    );
  }

  // ── Book checks ───────────────────────────────────────────────────────────
  const completedIds: string[] = [];
  // Load existing progress for appending (resume mode)
  if (isFullCatalog && resume && fs.existsSync(PROGRESS_FILE)) {
    const prior = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
    completedIds.push(...prior.completedIds);
  }

  if (books.length > 0) {
    console.log(`Checking ${books.length} books...`);
    for (let i = 0; i < books.length; i++) {
      const book = books[i];
      process.stdout.write(
        `  [${i + 1}/${books.length}] ${book.title.substring(0, 45).padEnd(45)} `
      );

      try {
        const finding = await checkBookPage(page, anthropic, book, {
          screenshotDir: SCREENSHOT_DIR,
          useHaiku,
        });
        findings.push(finding);

        if (finding.worstSeverity) {
          console.log(
            `${finding.worstSeverity} (${finding.issueCount} issues)`
          );
        } else {
          console.log("ok");
        }
      } catch (err) {
        console.log(`ERROR: ${err}`);
        findings.push(
          buildFinding(
            "book",
            book,
            null,
            [
              {
                check: "page_load",
                passed: false,
                severity: "P0",
                detail: `Page check threw error: ${err}`,
              },
            ],
            null
          )
        );
      }

      // Track progress in full-catalog mode
      if (isFullCatalog && book.id) {
        completedIds.push(book.id);
        // Save progress every 50 books so we can resume
        if (completedIds.length % 50 === 0) {
          saveProgress(completedIds);
          console.log(`  [progress saved: ${completedIds.length} books]`);
        }
      }

      // Small delay to avoid hammering the server
      await page.waitForTimeout(isFullCatalog ? 500 : 300);
    }

    // Final progress save + mark audited in DB
    if (isFullCatalog) {
      saveProgress(completedIds);
      console.log(`\nMarking ${completedIds.length} books as browser-audited in DB...`);
      await markBrowserAudited(completedIds);
    }
  }

  // ── Author checks ─────────────────────────────────────────────────────────
  if (authors.length > 0) {
    console.log(`\nChecking ${authors.length} authors...`);
    for (let i = 0; i < authors.length; i++) {
      const author = authors[i];
      process.stdout.write(
        `  [${i + 1}/${authors.length}] ${author.substring(0, 45).padEnd(45)} `
      );

      try {
        const finding = await checkAuthorSearch(page, author, {
          screenshotDir: SCREENSHOT_DIR,
        });
        findings.push(finding);

        if (finding.worstSeverity) {
          console.log(
            `${finding.worstSeverity} -- ${finding.resultCount} results`
          );
        } else {
          console.log(`ok (${finding.resultCount} results)`);
        }
      } catch (err) {
        console.log(`ERROR: ${err}`);
      }

      await page.waitForTimeout(300);
    }
  }

  await browser.close();

  // ── Build report ──────────────────────────────────────────────────────────
  const allIssues = findings.flatMap((f) => f.checks.filter((c) => !c.passed));
  const byCategory: Record<string, number> = {};
  const bySeverity: Record<Severity, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };

  for (const f of findings) {
    if (f.type === "book") {
      const cat = (f as BookFinding).category;
      byCategory[cat] = (byCategory[cat] ?? 0) + f.issueCount;
    }
    for (const s of Object.keys(bySeverity) as Severity[]) {
      bySeverity[s] += f.checks.filter(
        (c) => !c.passed && c.severity === s
      ).length;
    }
  }

  const report: AuditReport = {
    runAt: new Date().toISOString(),
    mode,
    baseUrl: BASE_URL,
    summary: {
      booksChecked: books.length,
      authorsChecked: authors.length,
      totalIssues: allIssues.length,
      byCategory,
      bySeverity,
      passRate:
        findings.length > 0
          ? Math.round(
              (findings.filter((f) => f.issueCount === 0).length /
                findings.length) *
                100
            )
          : 100,
    },
    knownBugVerification: knownBugResults,
    findings: findings.sort(
      (a, b) => getSeverityRank(a.worstSeverity) - getSeverityRank(b.worstSeverity)
    ),
  };

  // ── Save report ───────────────────────────────────────────────────────────
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .substring(0, 19);
  const reportPath = path.join(REPORTS_DIR, `audit-${ts}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // ── Print summary ─────────────────────────────────────────────────────────
  console.log("\n========================================");
  console.log("Audit Complete");
  console.log(`   Pass rate: ${report.summary.passRate}%`);
  console.log(`   Total issues: ${report.summary.totalIssues}`);
  console.log(
    `   P0: ${bySeverity.P0} | P1: ${bySeverity.P1} | P2: ${bySeverity.P2} | P3: ${bySeverity.P3}`
  );
  if (knownBugResults.length > 0) {
    console.log(
      `\n   Known bugs still open: ${stillOpenCount}/${knownBugResults.length}`
    );
    for (const b of knownBugResults) {
      const icon =
        b.stillPresent === true
          ? "OPEN"
          : b.stillPresent === false
            ? "FIXED"
            : "UNKNOWN";
      console.log(
        `   [${icon}] [${b.bugId}] ${b.description.substring(0, 60)}`
      );
    }
  }
  console.log(`\n   Report saved: ${reportPath}`);
  if (SCREENSHOT_DIR) console.log(`   Screenshots: ${SCREENSHOT_DIR}`);

  // ── Optional: push P0/P1 findings to quality_flags table ──────────────────
  if (
    pushToDb &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    console.log("\n   Pushing P0/P1 findings to quality_flags...");
    await pushFindingsToDb(findings);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
