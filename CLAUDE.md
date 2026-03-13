# Hotlist — Project Bible for Claude Code

## What is Hotlist?
A romance & romantasy book intelligence web app. Users search for books and get ratings from Goodreads, Amazon, and romance.io aggregated in one place, plus spice levels, trope tags, and an AI-generated synopsis. The signature feature is the "Hotlist" — a comparison table where users save multiple books side by side to decide what to read next. Affiliate buy links (Amazon) monetize the app.

## Audience
Romance and romantasy readers. Mobile-first. Non-technical users. The tone is warm, editorial, and a little spicy — never corporate.

## Tech Stack (do not deviate from this)
- **Framework**: Next.js 14 with App Router
- **Styling**: Tailwind CSS
- **Database + Auth**: Supabase (PostgreSQL + Supabase Auth)
- **Deployment**: Vercel
- **AI**: Anthropic Claude API (tiered approach):
  - `claude-haiku-4-5-20251001` for transcript extraction, synopsis generation, trope normalization, sentiment tagging, spice inference (high volume, cost-sensitive)
  - `claude-sonnet-4-6` for BookTok agent (vision + tool use for book identification, accuracy-critical, low volume)
- **Book metadata**: Google Books API + Open Library API
- **Data enrichment**: Web scraping via cheerio + node-fetch (Goodreads, Amazon). romance.io via Serper Google search (romance.io blocks direct scraping).
- **State/data fetching**: SWR

## Future iOS app
The backend is Supabase. The iOS app (Expo/React Native, built later) will connect directly to Supabase using the same project. Do NOT couple business logic to Next.js API routes — put it in Supabase (RLS policies, database functions) wherever possible so the mobile app can reuse it without a proxy.

## Key principles
1. **Mobile-first**: Design every screen for 375px wide first
2. **No auth walls**: Browsing, search, and book detail pages are public. Auth only triggers when saving to a Hotlist or rating a book
3. **Speed**: Cache aggressively. Book data from external sources should be cached in Supabase for 24 hours minimum
4. **Cost control**: Use Haiku for high-volume AI, Sonnet only for accuracy-critical BookTok tasks. Batch scraping jobs. Cache everything.
5. **Graceful degradation**: If scraping fails, show what we have. Never show a broken page.

## Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
GOOGLE_BOOKS_API_KEY=
NYT_BOOKS_API_KEY=             # New York Times Books API
NEXT_PUBLIC_AMAZON_AFFILIATE_TAG=
NEXT_PUBLIC_APP_URL=
SERPER_API_KEY=                # from serper.dev — Google search API for romance.io spice + Amazon ratings
RAPIDAPI_KEY=                  # from rapidapi.com — video downloader for BookTok
RAPIDAPI_VIDEO_HOST=           # specific host for chosen downloader API
OPENAI_API_KEY=                # from platform.openai.com — Whisper transcription
CRON_SECRET=                   # shared secret for Vercel cron job auth
SPICE_LLM_DAILY_LIMIT=        # optional, default 100 — max LLM spice inferences per day
```

## Brand
- Name: **Hotlist**
- Tagline: "Your next great read, already waiting."
- Primary color: `#d4430e` (fire orange-red)
- Background: `#faf7f2` (warm cream)
- Ink: `#12080a`
- Font display: Playfair Display (serif, italic for emphasis)
- Font body: Libre Baskerville
- Font mono/labels: DM Mono
- Spice icon: pepper emoji (1-5 scale)
- Brand icon: fire emoji

## Data sources — canonical hierarchy

| Source | Role | What it provides |
|--------|------|-----------------|
| **Goodreads** | Canonical identity | Book ID, title, author, cover, rating, genres, series, description |
| **Google Books** | Metadata + provisional entries | ISBN, page count, publisher, cover. Also the source for books not yet on Goodreads. |
| **Open Library** | Metadata fallback | ISBN, page count, publisher (if Google Books misses) |
| **NYT Books API** | Discovery only | "What's Hot" row. Every NYT title resolved to Goodreads ID before storing. |
| **Amazon** | Affiliate links + rating | ASIN for buy links, ratings via Serper Google search |
| **Romance.io** | Spice ratings (high confidence) | Spice level + heat label, scraped via Serper Google search |

**Book identity rule:** Books may enter the database without a Goodreads ID (from Google Books, BookTok, imports). The enrichment queue attempts to resolve them to Goodreads. Books with a Goodreads ID get richer data (genres, series, description).

## Composite Spice Architecture

Spice scores come from 5 weighted signals stored in the `spice_signals` table. The composite engine (`/lib/spice/compute-composite.ts`) produces a weighted average:

| Source | Weight | Confidence | How it works |
|--------|--------|------------|--------------|
| `community` | 1.0 | 0.55–1.0 (scales with count) | Aggregated from user_ratings. Our data moat. |
| `romance_io` | 0.85 | ~0.85 | Scraped via Serper from romance.io pages |
| `review_classifier` | 0.6 | varies | Keyword matching on Goodreads/Amazon reviews, LLM fallback |
| `llm_inference` | 0.4 | varies | Claude Haiku reads the book description |
| `genre_bucketing` | 0.2 | ~0.2–0.5 | Rule-based from genre tags (e.g., "erotica" → 5.0) |

**Conflict detection:** When two signals disagree by >2.0 peppers, the book is flagged and attribution reads "Spice estimates vary — community ratings help!"

### Spice files (`/lib/spice/`)
- `compute-composite.ts` — weighted composite engine, batch queries
- `community-aggregation.ts` — rolls up user_ratings into community signal
- `genre-bucketing.ts` — rule-based spice from genre tags
- `llm-inference.ts` — Claude Haiku inference from descriptions (daily limit)
- `review-classifier.ts` — keyword + LLM fallback from review text
- `review-fetcher.ts` — scrapes Goodreads reviews, Serper for Amazon snippets

### Spice UI components (`/components/books/`)
- `SpiceAttribution.tsx` — shows source text with varying opacity by confidence
- `SpiceDisplay.tsx` — unified peppers + attribution, compact mode for tables

## Data model

All tables in the public schema:

| Table | Purpose |
|-------|---------|
| `books` | Canonical book records. `goodreads_id` is UNIQUE but nullable (provisional entries). `enrichment_status`: pending → partial → complete. |
| `enrichment_queue` | Async enrichment jobs with retry logic. Job types: goodreads_detail, goodreads_rating, amazon_rating, romance_io_spice, metadata, ai_synopsis, trope_inference, review_classifier, llm_spice |
| `book_ratings` | Per-source star ratings (goodreads, amazon, romance_io) |
| `book_spice` | Legacy spice table (romance_io, hotlist_community, goodreads_inference). Being superseded by `spice_signals`. |
| `spice_signals` | New multi-signal spice table. One row per book per source. Columns: book_id, source, spice_value, confidence (0–1), evidence (JSONB). |
| `tropes` | Canonical trope list (id, slug, name, description) |
| `book_tropes` | Junction: books ↔ tropes |
| `user_ratings` | Per-user star_rating (1–5) + spice_rating (1–5) per book. DB trigger `trg_refresh_community_spice` auto-aggregates into spice_signals. |
| `reading_status` | want_to_read / reading / read per user per book |
| `hotlists` | User-created comparison lists |
| `hotlist_books` | Books within a hotlist (position, added_at) |
| `profiles` | Extended user data |
| `homepage_cache` | Cached book ID lists for homepage rows (24h TTL) |
| `nyt_trending` | NYT bestseller entries with rank + weeks_on_list |
| `video_grabs` | BookTok pipeline cache — never process the same URL twice |
| `grab_feedback` | User feedback on BookTok results (wrong_book, wrong_edition, missing_book). Anonymous inserts via RLS. |
| `agent_debug_logs` | Debug traces from BookTok agent runs (url, log_entries JSONB) |
| `cron_logs` | Cron job execution logs |
| `pro_waitlist` | Email capture for future Pro tier |

## File structure

```
/app                          — Next.js App Router pages
/app/api                      — API routes (keep thin — logic in /lib)
/app/api/cron/                — Vercel cron endpoints (see Cron Jobs below)
/app/api/books/               — Book operations (search, enrich, refresh-spice)
/app/api/grab/                — BookTok video grab (streaming)
/app/book/[slug]/             — Book detail page + SpiceSection
/app/booktok/                 — BookTok UI
/app/search/                  — Search results page

/lib/books/                   — Book service modules
  index.ts                    — main entry: findBook, getBookDetail, getBooksByTrope
  goodreads-search.ts         — Goodreads scraping, search, genre check, slug generation
  cache.ts                    — Supabase read/write, hydration, saveBookToCache, saveProvisionalBook
  google-books.ts             — Google Books API
  open-library.ts             — Open Library API
  nyt-lists.ts                — NYT bestseller integration
  new-releases.ts             — Google Books new releases in romance
  metadata-enrichment.ts      — supplementary metadata from Google/OL
  romance-filter.ts           — romance genre guard + junk title filter
  ai-synopsis.ts              — Claude-generated synopses

/lib/enrichment/              — Async enrichment queue
  queue.ts                    — job queueing, fetching, status, retry with exponential backoff
  worker.ts                   — job processor (dispatches to enrichment functions)

/lib/scraping/                — Per-site scrapers
  goodreads.ts                — Goodreads rating scraper
  amazon-search.ts            — Amazon ratings via Serper Google search
  romance-io-search.ts        — Romance.io spice via Serper Google search
  amazon.ts                   — DEPRECATED: direct Amazon scraping (returns 503)

/lib/spice/                   — Composite spice scoring system (see above)

/lib/video/                   — BookTok pipeline
  downloader.ts               — RapidAPI video downloader
  transcription.ts            — OpenAI Whisper
  frame-extractor.ts          — ffmpeg frame extraction from video
  book-agent.ts               — Single Sonnet agent (vision + transcript + Goodreads tool use)
  book-resolver.ts            — Types only (ResolvedBook, etc.)
  index.ts                    — Pipeline orchestrator
  vision-extractor.ts         — DEPRECATED (replaced by book-agent.ts)
  book-extractor.ts           — DEPRECATED (replaced by book-agent.ts)
  reconciler.ts               — DEPRECATED (replaced by book-agent.ts)

/components/books/            — Book-specific components (BookCard, SpiceDisplay, SpiceAttribution)
/components/ui/               — Base UI primitives (Badge, BookCover, SpiceIndicator)
/components/hotlists/         — Hotlist table + detail components
/components/layout/           — Navbar, layout shell
```

## BookTok feature (formerly "Grab from Video")
- Video download: RapidAPI (third-party TikTok/Instagram/YouTube downloader)
- Transcription: OpenAI Whisper API (model: whisper-1) — NOT Claude
- Frame extraction: ffmpeg via ffmpeg-static (up to 20 frames, subsampled to 8 for agent)
- **Book identification: Single Claude Sonnet (`claude-sonnet-4-6`) agent with tool use — sees video frames, reads transcript, searches & confirms books on Goodreads in real time**
- Cache: `video_grabs` Supabase table — never process the same URL twice
- UI: `/app/booktok/page.tsx` (old `/app/grab/page.tsx` redirects here)
- API: `/app/api/grab/route.ts` (streaming)
- URL detection: SearchBar auto-detects video URLs and redirects to `/booktok?url=...`
- Cost: ~$0.05-0.10 per grab (vision + tool use, but only ONE Sonnet call)

### BookTok pipeline (in order):
1. Validate URL + check cache
2. Download video/audio via RapidAPI
3. Transcribe audio via Whisper + extract frames via ffmpeg (parallel)
4. Single Sonnet agent call: vision + transcript + Goodreads tool use
   → Agent reads covers, understands transcript, searches Goodreads, confirms editions, returns verified canonical results
5. Queue enrichment for all matched books (fire-and-forget via `queueEnrichmentJobs`)
6. Cache result in `video_grabs` table

## Enrichment Architecture

Book data flows through two independent systems:

### Search (fast, always works)
- Supabase full-text + trigram search on cached books
- Google Books API as a fallback for undiscovered books
- Never waits for Goodreads scraping
- Returns results in < 500ms

### Enrichment Queue (async, resilient)
- `enrichment_queue` table tracks jobs per book per source
- Job types: goodreads_detail, goodreads_rating, amazon_rating, romance_io_spice, metadata, ai_synopsis, trope_inference, review_classifier, llm_spice
- Each job retries up to 3 times with exponential backoff (30s, 2min, 10min)
- Cron worker runs every 5 minutes (`/api/cron/enrichment-worker`)
- `enrichment_status` on books table: "pending" → "partial" → "complete"
- Book detail pages poll for updates when enrichment is incomplete
- **Grab pipeline queues enrichment at grab time** (step 9) so data is ready before books hit a hotlist
- **Hotlist pages poll** `/api/books/refresh-batch` every 8s when un-enriched books are detected, auto-stopping when data arrives
- Enrichment banner shows above the hotlist table while books are being enriched

### Files
- `/lib/enrichment/queue.ts` — queue management (add, fetch, complete, fail)
- `/lib/enrichment/worker.ts` — job processor (dispatches to appropriate enrichment function)
- `/app/api/cron/enrichment-worker/route.ts` — cron endpoint
- `/app/api/books/refresh-batch/route.ts` — batch book hydration endpoint (used by hotlist polling)

## Cron Jobs (vercel.json)

| Path | Schedule | Purpose |
|------|----------|---------|
| `/api/cron/enrichment-worker` | Every 5 min | Process pending enrichment queue jobs |
| `/api/cron/spice-backfill` | Every 6 hours | LLM inference + review classifier backfill |
| `/api/cron/refresh-spice` | Daily 4 AM UTC | Re-aggregate community signals, queue stale romance_io re-scrapes, recompute genre bucketing |
| `/api/cron/weekly-refresh` | Tuesdays 10 AM UTC | Refresh stale book data |
| `/api/cron/monthly-enrichment` | 1st of month 2 AM UTC | Bulk enrichment pass |
| `/api/cron/seed-lists` | Sundays 6 AM UTC | Seed/refresh curated book lists |
| `/api/cron/openlibrary-discovery` | Wednesdays 4 AM UTC | Discover new books via Open Library |

All cron endpoints require `Authorization: Bearer $CRON_SECRET`.

## Coding style
- TypeScript everywhere
- Server components by default; use `'use client'` only when needed
- Prefer Supabase RLS over API route auth checks
- Use `zod` for all API input validation
- Meaningful variable names — this codebase may be read by a non-engineer
- Comment complex logic clearly
