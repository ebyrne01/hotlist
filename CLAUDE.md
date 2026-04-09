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
RAPIDAPI_TIKTOK_HOST=          # optional — specialized TikTok downloader API host (e.g. tiktok-downloader...p.rapidapi.com)
OPENAI_API_KEY=                # from platform.openai.com — Whisper transcription
CRON_SECRET=                   # shared secret for Vercel cron job auth
AI_SYNOPSIS_DAILY_LIMIT=      # optional, default 50 — max on-demand AI synopsis generations per day
AI_RECOMMENDATIONS_DAILY_LIMIT= # optional, default 25 — max on-demand AI recommendation generations per day
APIFY_API_TOKEN=              # from apify.com — Amazon product scraping for bulk enrichment
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
| **Amazon** | Affiliate links + rating | ASIN for buy links, ratings via Serper Google search. ASIN extraction is independent of rating — worker saves ASINs even when Amazon suppresses star ratings (~58% of books). Rating hit rate ceiling is ~42% due to Amazon blocking rating data from Google search results. |
| **Romance.io** | Spice + tropes (high confidence) | Spice level + heat label + star rating + trope tags, scraped via Serper Google search. Two-query approach: (1) `site:romance.io "{title}" "tagged as"` anchors snippet on the tag section for spice + tags, (2) `site:romance.io "{title}" "of 5 stars"` anchors on the rating section — only fires when query 1 matched but missed the star rating. Tag classification maps romance.io tags → canonical trope slugs via `romance-io-tags.ts`. |

**Book identity rule:** Books may enter the database without a Goodreads ID (from Google Books, BookTok, imports). The enrichment queue attempts to resolve them to Goodreads. Books with a Goodreads ID get richer data (genres, series, description).

## Composite Spice Architecture

Spice scores come from 5 weighted signals stored in the `spice_signals` table. The composite engine (`/lib/spice/compute-composite.ts`) produces a weighted average:

| Source | Weight | Confidence | How it works |
|--------|--------|------------|--------------|
| `community` | 1.0 | 0.55–1.0 (scales with count) | Aggregated from user_ratings. Our data moat. |
| `romance_io` | 0.85 | 0.7–0.85 | Scraped via Serper from romance.io pages. Uses structured `rating`/`ratingCount` fields + snippet parsing. Searches books, series, and author pages. High confidence (0.85) = title+author in slug; Medium (0.7) = partial match. |
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
| `books` | Canonical book records. `goodreads_id` is UNIQUE but nullable (provisional entries). `enrichment_status`: pending → partial → complete. `is_canon`: only canon books appear on public surfaces. Canon gate auto-promotes when enrichment completes + passes quality checks. |
| `enrichment_queue` | Async enrichment jobs with retry logic. Job types: goodreads_detail, goodreads_rating, amazon_rating, romance_io_spice, metadata, spotify_playlists, reddit_buzz, discussion_links. LLM jobs (ai_synopsis, ai_recommendations) moved to on-demand; others (trope_inference, review_classifier, llm_spice, booktrack_prompt) paused. |
| `book_ratings` | Per-source star ratings (goodreads, amazon, romance_io) |
| `book_spice` | Legacy spice table (romance_io, hotlist_community, goodreads_inference). Being superseded by `spice_signals`. |
| `spice_signals` | New multi-signal spice table. One row per book per source. Columns: book_id, source, spice_value, confidence (0–1), evidence (JSONB). |
| `tropes` | Canonical trope list (id, slug, name, description) |
| `book_tropes` | Junction: books ↔ tropes |
| `book_recommendations` | AI-generated "Readers Also Loved" recs. Cached per book (book_id → recommended_book_id with reason + position). Generated by Haiku via enrichment queue. |
| `user_ratings` | Per-user star_rating (1–5) + spice_rating (1–5) per book. DB trigger `trg_refresh_community_spice` auto-aggregates into spice_signals. |
| `reading_status` | Reader responses per user per book. Response types: pre-read (must_read, on_the_shelf, not_for_me) and post-read (loved_it, it_was_fine, didnt_finish). Legacy status column (want_to_read/reading/read) dual-written for backward compat. |
| `book_discussion_links` | Curated discussion links per book (Reddit threads, blog posts). Populated by `discussion_links` enrichment job via Serper. Columns: book_id, url, title, source, source_detail, comment_count. |
| `hotlists` | User-created comparison lists. BookTok grabs store `source_creator_handle`, `source_video_url`, `source_video_thumbnail`, `source_platform`. |
| `hotlist_books` | Books within a hotlist (position, added_at) |
| `profiles` | Extended user data. Creator fields: `is_creator`, `creator_verified_at`, `vanity_slug` (UNIQUE), `bio`, `tiktok_handle`, `instagram_handle`, `youtube_handle`, `blog_url`, `amazon_affiliate_tag`, `bookshop_affiliate_id` |
| `creator_applications` | Self-serve creator verification requests. Status: pending → approved / rejected. Columns: `reviewer_note` (text, optional rejection feedback), `reviewed_at` (timestamptz), `claim_handle_id` (uuid FK → creator_handles, links claim requests to auto-generated handles) |
| `analytics_events` | Lightweight event tracking (profile_view, affiliate_click, etc.) |
| `homepage_cache` | Cached book ID lists for homepage rows (24h TTL) |
| `nyt_trending` | NYT bestseller entries with rank + weeks_on_list |
| `video_grabs` | BookTok pipeline cache — never process the same URL twice. Stores `video_title` (TikTok caption) for hotlist naming. |
| `grab_feedback` | User feedback on BookTok results (wrong_book, wrong_edition, missing_book). Anonymous inserts via RLS. |
| `agent_debug_logs` | Debug traces from BookTok agent runs (url, log_entries JSONB) |
| `creator_handles` | Auto-populated from video grabs. Tracks every BookTok creator. Unique on (handle, platform). |
| `creator_book_mentions` | Junction: creators ↔ books. Denormalized from video_grabs for fast queries. Includes sentiment + quote. |
| `user_follows` | Readers follow creator handles. RLS: users manage own follows. |
| `book_buzz_signals` | Buzz events from discovery channels (reddit_mention, amazon_bestseller, booktok_grab, nyt_bestseller). One per book per source per day. Powers "What's Hot" ranking via time-decayed composite scoring. |
| `cron_logs` | Cron job execution logs |
| `pro_waitlist` | Email capture for future Pro tier |
| `quality_flags` | Quality issue tracking (book_id, field_name, issue_type, source, priority P0-P3, auto_fixable, status). Sources: rules_engine, haiku_scanner, browser_harness, admin, feedback. |
| `quality_health_log` | Weekly quality snapshots: canon count, coverage %, flag counts, enrichment status, search eval results. One row per pipeline run. |
| `serper_query_cache` | Caches Serper search results (query_hash PK, result_status, miss_count). 30-day TTL. Prevents re-querying known misses. |
| `search_analytics` | Search feedback (thumbs up/down on results). |
| `search_intent_cache` | Cached NL search intent classifications. |
| `reading_dna` | Per-user reading preference profile (trope affinities, spice preference, subgenre_preferences text[], DNA blurb). |
| `user_cw_preferences` | Per-user content warning preferences (user_id, cw_category). |
| `reading_dna_signals` | Individual signals that feed into reading DNA computation. |
| `book_trope_vectors` | Precomputed trope similarity vectors for recommendation engine. |
| `harvest_log` | Logs each harvest upload: user_id, books_submitted/added/updated/skipped, sources array. |

## File structure

```
/app                          — Next.js App Router pages
/app/api                      — API routes (keep thin — logic in /lib)
/app/api/cron/                — Vercel cron endpoints (see Cron Jobs below)
/app/api/books/               — Book operations (search, enrich, refresh-spice, on-demand synopsis + recommendations)
/app/api/get-started/rate/    — Batch reader response API for onboarding rate-books path
/app/api/get-started/import/  — Goodreads CSV import API (match + apply phases)
/app/api/get-started/creators/ — Creator search, book aggregation, follow + response API
/app/api/hotlists/[shareSlug]/og-image/ — Satori OG image generation (Edge runtime, 1200x630 + 1080x1920)
/app/api/grab/                — BookTok video grab (streaming)
/app/api/admin/quality/       — Quality flag CRUD, scorecard, health, scan APIs
/app/api/admin/creators/      — Creator application list + review (approve/reject) APIs
/app/api/creators/claim/      — Claim request API for auto-generated creator handles
/app/api/reading-dna/          — Reading DNA test: save results, search books, get suggestions, user profile
/app/api/seed/harvest/        — Harvest API: receives book batches from Chrome extension harvester
/app/admin/quality/           — Admin quality dashboard (triage + monitoring widgets)
/app/admin/harvest/           — Admin harvest dashboard (recent uploads, stats, source frequency)
/app/admin/creators/          — Admin creator application dashboard (approve/reject with notes)
/app/book/[slug]/             — Book detail page (single-column narrative arc: Identity → WhatsHot → CoolYouOff → Synopsis → Stay in the World → Series → Get This Book)
/app/get-started/             — Multi-path onboarding landing (rate books, Goodreads import, follow creators)
/app/get-started/rate/        — Path 3: Rate popular books to build taste profile + auto-create Hotlist
/app/get-started/import/      — Path 2: Goodreads CSV import with book matching + response mapping
/app/get-started/creators/    — Path 1: Follow BookTok creators, rate their top picks
/app/genre/                   — Genre browsing pages
/app/booktok/                 — BookTok UI
/app/discover/                — Creator discovery index (trending + all creators)
/app/discover/[handle]/       — Auto-generated creator page (books, follow, claim)
/app/profile/creator/         — Creator settings page (application form or settings)
/app/[vanitySlug]/            — Public creator profile (vanity URL, reserved word guard)
/app/api/analytics/event/     — Analytics event tracking endpoint
/app/api/books/lookup/        — Book lookup for Chrome extension (multi-identifier, CORS)
/app/reading/dna/             — Reading DNA test: 6-step flow (subgenre → spice → tropes → books → disliked → warnings). Results page shows DNA profile + "Does this sound like you?" with For You preview.
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
  ai-synopsis.ts              — Claude-generated synopses, triggered on-demand from book detail page (daily cap via AI_SYNOPSIS_DAILY_LIMIT)
  ai-recommendations.ts      — AI-powered "Readers Also Loved" via Haiku, triggered on-demand from book detail page (cached in book_recommendations, daily cap via AI_RECOMMENDATIONS_DAILY_LIMIT)
  author-crawl.ts             — Crawl author's full bibliography (romance genre guard filters non-romance)
  buzz-signals.ts             — Record buzz events (reddit, amazon, booktok, nyt) to book_buzz_signals table
  buzz-score.ts               — Composite buzz scoring: time-decayed weighted signals, used by "What's Hot"
  reddit-discovery.ts         — Reddit romance community discovery via Serper + Haiku
  amazon-bestseller-discovery.ts — Amazon bestseller discovery via Serper
  subgenre-classifier.ts      — Rules-based classifier: maps genre tags to 8 canonical subgenres (romantasy, paranormal, sci-fi-romance, historical, romantic-suspense, dark-romance, erotic-romance, contemporary)
  spice-gap-monitor.ts        — Monthly audit of spice coverage gaps

/lib/creators/                — Creator discovery system
  register.ts                 — Upsert creator handle + book mentions after each grab

/lib/reading-dna/             — Reading DNA preference engine
  compute.ts                  — buildDnaProfile(): aggregates quiz + rating signals into trope affinities + spice preference
  score.ts                    — scoreBook(), rankBooks(), reRankByDna(): dot-product trope scoring with multiplicative spice penalty (0.3–1.0 Gaussian)
  index.ts                    — getDna(), saveDna(): Supabase CRUD for reading_dna table
  generate-blurb.ts           — Haiku-generated personality blurb from DNA profile

/lib/enrichment/              — Async enrichment queue
  queue.ts                    — job queueing, fetching, status, retry with exponential backoff
  worker.ts                   — job processor (dispatches to enrichment functions)
  discussion-links.ts         — Serper-based enrichment: fetches Reddit threads + blog posts about a book (3 parallel queries)
  reddit-buzz.ts              — Serper-based enrichment: fetches Reddit buzz signals for a book

/lib/import/                  — Goodreads import pipeline
  goodreads-csv.ts            — RFC 4180 CSV parser for Goodreads exports (handles ="..." ISBN wrapping)
  book-matcher.ts             — Batch book matching: goodreads_id → ISBN13 → ISBN → title+author fuzzy

/lib/hotlist-share-data.ts    — getHotlistShareData(): fetches hotlist name, covers, spice range, shared tropes for OG images

/lib/scraping/                — Per-site scrapers
  goodreads.ts                — Goodreads rating scraper
  amazon-search.ts            — Amazon ratings + ASINs via Serper (3-strategy fallback, returns ASINs even without ratings)
  romance-io-search.ts        — Romance.io spice+rating+tags via Serper (query: `site:romance.io "{title}" "tagged as"`, fallback to `romance.io rating "{title}" "{author}"`)
  romance-io-tags.ts          — Tag classification: maps romance.io tags → canonical trope slugs, categorizes genres/CWs/character/relationship tags
  amazon.ts                   — DEPRECATED: direct Amazon scraping (returns 503)

/lib/hotlists.ts              — Hotlist CRUD operations (getUserHotlists, getHotlistWithBooks)

/lib/spice/                   — Composite spice scoring system (see above)

/app/lists/                   — Hotlist pages
  page.tsx                    — User's hotlist index
  [slug]/page.tsx             — Hotlist detail (server component)
  [slug]/HotlistDetailClient.tsx — Hotlist detail (client: polling, inline edit, sharing)

/lib/video/                   — BookTok pipeline
  downloader.ts               — RapidAPI video downloader (with TikTok-specific fallback)
  transcription.ts            — OpenAI Whisper
  transcript-preprocessor.ts  — Whisper error correction, noise removal
  frame-extractor.ts          — ffmpeg frame extraction (duration probe + adaptive density, 30 frames max)
  book-agent.ts               — Two-phase pipeline: Haiku observe + Sonnet verify (anti-hallucination + recurring result override)
  agent-search.ts             — Tiered search for agent (local DB → fuzzy trigram → Google Books → Goodreads, with smart query variations + OCR correction)
  book-resolver.ts            — Types only (ResolvedBook, etc.)
  caption-validator.ts        — Backup caption check: cross-references video title against agent results
  index.ts                    — Pipeline orchestrator
/scripts/seed-from-csv.ts      — CLI harvest import from CSV files

/extension-harvest/            — Book Harvester Chrome extension (admin tool, separate from user extension)
  manifest.json                — Manifest V3
  popup.html/js/css            — Popup UI: scan, batch, export CSV, upload
  background.js                — Badge handler
  parsers/utils.js             — Shared parser helpers
  parsers/goodreads-list.js    — Goodreads list/genre/shelf parser
  parsers/amazon-list.js       — Amazon category/bestseller parser
  parsers/romanceio.js         — Romance.io list parser
  parsers/generic-links.js     — Blog/generic fallback parser

/components/books/            — Book-specific components (BookCard, BookRow, SpiceDisplay, SpiceAttribution, ReaderResponse, WhatsHot, WhatMightCoolYouOff, DiscussionHub)
/components/ui/               — Base UI primitives (Badge, BookCover, SpiceIndicator)
/components/hotlists/         — Hotlist table + detail components + HotlistShareSheet
/components/layout/           — Navbar, layout shell
/components/homepage/         — PersonalizedShell (client: For You row + hotlist bar)
/components/home/             — ForYouRow, DnaCtaBanner, UserHotlistBar, HeroSection, GenrePills, ShowcaseGrid
/components/onboarding/       — BookPicker (rate books grid), GoodreadsImporter (CSV import flow), CreatorFollowFlow (follow + rate)
/components/dna/              — DnaProgressBar (fire gradient progress toward 25-book DNA unlock)
/components/profile/          — ReadingDnaCard (DNA summary on profile page)
```

## BookTok feature (formerly "Grab from Video")
- Video download: RapidAPI (third-party TikTok/Instagram/YouTube downloader, with specialized TikTok fallback)
- **Supports videos AND photo/carousel posts** (TikTok `/photo/` URLs with multiple slide images)
- Transcription: OpenAI Whisper API (model: whisper-1) — NOT Claude. Skipped for carousel posts.
- Frame extraction: ffmpeg for videos. Duration probe via `ffmpeg -i -t 0` reads video length from header (~350ms), then spaces up to 30 frames evenly across the full duration. First frame captured at t=0. Carousel posts use slide image URLs directly.
- **Book identification: Two-phase pipeline (Haiku observe + Sonnet verify) — see below**
- **Anti-hallucination rules**: Agent never guesses books from creator handles, partial/blurry covers, or music lyrics. Haiku must read titles from covers — cannot invent titles when transcript doesn't name one. Sonnet uses "recurring result override" when search consistently returns the same book by the same author (catches hallucinated titles).
- Cache: `video_grabs` Supabase table — never process the same URL twice
- UI: `/app/booktok/page.tsx` (old `/app/grab/page.tsx` redirects here)
- API: `/app/api/grab/route.ts` (streaming)
- URL detection: SearchBar auto-detects video URLs and redirects to `/booktok?url=...`
- Cost: ~$0.02-0.05 per grab (Haiku vision + Sonnet text-only verification)

### BookTok pipeline (in order):
1. Validate URL + check cache
2. Download video/audio via RapidAPI (detects carousel vs video posts)
3. Transcribe audio via Whisper + extract frames via ffmpeg (parallel). Carousel posts skip Whisper, use slide images directly.
4. **Phase 1 — Haiku observation** (single turn, vision + transcript, no tools): Reads ALL frames + full transcript. Returns structured candidate list with title, author, source, confidence, sentiment, and creator quote. Filters out comparison books ("if you loved X") and series predecessors.
5. **Phase 2 — Sonnet verification** (multi-turn, text-only, tool use): Takes candidate list (NO images), searches Goodreads via tiered search (local DB → fuzzy trigram → Google Books → Goodreads scraping), confirms book identities, submits final verified list. Max 7 turns, 3-min time budget. Critical rule: never swaps candidates for Book 1 of their series. Retry strategy: author alone → title alone → distinctive word → OCR error correction. Recurring result override: if search keeps returning the same book by the same author, swap to it. Search includes code-level OCR correction (`generateOcrVariations`) for stylized font misreads (e.g., "Hush"→"Heat") and `hasTitleWordOverlap` guards against false-positive fuzzy/Google Books results.
6. **Caption validation** (backup check): Cross-references the TikTok caption (`video_title`) against agent results. If caption names a book the agent missed → search and add it. If agent returned 1 book but caption names a different one → prepend caption's pick (likely the featured book, agent matched a visible-but-not-featured cover). Skips comparison captions ("if you loved X"). Module: `caption-validator.ts`.
7. **Series expansion** (post-resolution): When `isSeriesVideo: true` and Haiku flagged candidates with `seriesRecommendation: true`, queries the DB for sibling books in the same series and adds them. Guards against foreign editions via duplicate series-position check. Only adds canon books with covers already in the DB.
8. Queue enrichment for all matched books (awaited) + **kick off enrichment worker immediately** (fire-and-forget, no 5-min wait)
9. Cache result in `video_grabs` table (includes `video_title` from RapidAPI)
10. Register creator handle + book mentions in `creator_handles` / `creator_book_mentions` (awaited — must complete before streaming response closes)

### Hotlist creation from grabs
- Hotlist name uses the **video title/caption** (hashtags stripped), e.g. "All the books we gave 5 stars in 2025"
- Falls back to `"@handle picks"` if no video title available
- Creator handle stored as `source_creator_handle` and displayed as a byline linking to `/discover/@handle`
- Both theme and creator handle are searchable

### Grab results UI
- Results page shows identified books (cover, title, author, series) without enrichment data
- Repeated creator quotes (themed lists) are deduplicated and shown as a list-level summary
- Per-book quotes display only when unique to each book
- CTA: "Add all N to a Hotlist" → hotlist page shows enriched data with live polling

## Creator Discovery

- `creator_handles` table: auto-populated from video grabs, tracks every BookTok creator whose videos have been processed
- `creator_book_mentions`: denormalized junction table — which creators recommended which books, with sentiment + quotes
- `user_follows`: readers can follow creator handles
- `/discover` — browseable index of all discovered creators, with trending section
- `/discover/[handle]` — auto-generated page showing all books recommended by a creator, with follow button
- "Seen on BookTok" section on book detail pages shows which creators recommended each book
- Hotlists created from BookTok grabs use video title as name + creator handle as byline (see "Hotlist creation from grabs" above)
- **Claim flow**: Creators can claim their auto-generated handle via interactive banner on `/discover/@handle`. Clicking "Claim" (requires auth) creates a `creator_applications` entry with `claim_handle_id` linked. Admin approves → sets `creator_handles.claimed_by`, promotes user to verified creator. Claimed handles with vanity slugs show "Visit full profile" link.

## Creator Platform

Verified creators get a public profile and affiliate monetization:

- **Self-serve application**: `/profile/creator` — non-creators fill out application form → `creator_applications` table (status: pending → approved/rejected). Rejected creators see reviewer feedback + re-apply button. Pending shows submission date + "within 48 hours" messaging.
- **Admin approval**: `/admin/creators` — admin dashboard with status tabs (pending/approved/rejected), approve/reject buttons, optional rejection note. Claim applications show link to `/discover/@handle`. Accessible via admin nav links in Navbar.
- **Creator settings**: Verified creators manage vanity URL (min 3 chars, lowercase+numbers+hyphens, uniqueness check), bio, social handles, Amazon affiliate tag, Bookshop.org affiliate ID. "View your public profile" link shown when vanity slug is set.
- **Public profile**: `/{vanitySlug}` — server-rendered page with avatar, bio, verified badge, social links, public hotlists with mini book covers, reading stats. Reserved word guard prevents conflicts with app routes.
- **Affiliate tag threading**: Creator's `amazon_affiliate_tag` flows through `getHotlistWithBooks()` → `HotlistDetail.ownerAffiliateTag` → `HotlistTable.affiliateTag` → Buy links. Default tag (`NEXT_PUBLIC_AMAZON_AFFILIATE_TAG`) used when no creator tag is set.
- **Auto-Hotlist creator mode**: When verified creators use BookTok grab, hotlists are auto-set to public (`is_public: true`)
- **Analytics**: `analytics_events` table tracks profile_view, affiliate_click, etc. API: `POST /api/analytics/event`

## Chrome Extensions

### User-facing extension (`extension/`)

Browser extension that meets users on Goodreads, Amazon, and video sites:

- **Manifest V3**: `extension/manifest.json`
- **Goodreads overlay** (`content-goodreads.js`): Injects spice, tropes, Amazon rating comparison below the Goodreads rating section. Auto-provisions books not in DB via lookup API.
- **Amazon overlay** (`content-amazon.js`): Injects Goodreads rating, spice, tropes on book product pages. SPA-aware via MutationObserver.
- **Video detection** (`content-video.js`): Detects TikTok/Instagram/YouTube video pages, activates popup grab.
- **Popup** (`popup.html/js`): BookTok grab UI with streaming progress, results display.
- **Backend**: `/api/books/lookup` — multi-identifier lookup (goodreads_id, isbn, asin, title+author), CORS-enabled, auto-provisioning.
- **CORS**: `lib/api/cors.ts` shared utility. All data is public, no auth needed.

### Book Harvester extension (`extension-harvest/`)

Admin-only Chrome extension for bulk book discovery from Goodreads, Amazon, romance.io, and blog pages. Separate from the user-facing extension.

- **Manifest V3**: `extension-harvest/manifest.json` — permissions for `activeTab`, `scripting`, `storage`, `unlimitedStorage`
- **Parsers** (`extension-harvest/parsers/`): Site-specific IIFE scripts injected via `chrome.scripting.executeScript()` with `world: "MAIN"`:
  - `utils.js` — shared helpers: `dedupKey()`, `parseSeries()`, `cleanTitle()`, `cleanAuthor()`, `normalizeFormat()`, `mergeBooks()`
  - `goodreads-list.js` — extracts books from Goodreads list/genre/shelf pages (schema.org rows + fallback link scraping). Captures GR ID, rating, rating count, cover, series, format.
  - `amazon-list.js` — extracts books from Amazon category/bestseller/new-release pages. Captures ASIN, rating, rating count, cover, series, format.
  - `romanceio.js` — extracts books from romance.io/new and /top pages. Captures title, author, cover, spice level (flame emoji/SVG/class detection).
  - `generic-links.js` — fallback parser for blog pages.
- **Popup** (`popup.html/js/css`): Scan Page button, book preview, batch accumulation (stored in `chrome.storage.local`), Export CSV, Upload to Hotlist.
- **Source picker**: Categorized dropdown of harvest source URLs (Goodreads, Amazon, romance.io, blogs). Navigates the active tab on selection.
- **Auth**: First upload prompts for API key (`CRON_SECRET`), stored in `chrome.storage.local`, sent as `Authorization: Bearer` header.
- **Backend**: `POST /api/seed/harvest` — receives up to 500 books per batch, deduplicates (GR ID → ASIN → ISBN → normalized title+author), writes pre-captured ratings to `book_ratings` and `spice_signals`, queues enrichment with `skipJobTypes` optimization. CORS-enabled. Auth via admin session or `Bearer CRON_SECRET`.
- **Admin dashboard**: `/admin/harvest` — shows recent harvests, aggregate stats, source frequency.
- **CLI import**: `scripts/seed-from-csv.ts` — reads CSV, maps columns, POSTs to harvest endpoint.

## Enrichment Architecture

Book data flows through two independent systems:

### Search (fast, always works)
- Supabase full-text + trigram search on cached books
- Google Books API as a fallback for undiscovered books
- Never waits for Goodreads scraping
- Returns results in < 500ms

### Enrichment Queue (async, resilient)
- `enrichment_queue` table tracks jobs per book per source
- **Active job types**: goodreads_detail, goodreads_rating, amazon_rating, romance_io_spice, metadata, spotify_playlists, reddit_buzz, discussion_links
- **Paused LLM jobs** (removed from batch, high coverage already achieved): trope_inference, review_classifier, llm_spice, booktrack_prompt
- **On-demand LLM jobs** (triggered by user visiting book detail page): ai_synopsis, ai_recommendations
- Each job retries up to 3 times with exponential backoff (30s, 2min, 10min)
- **Priority tiers**: Tier 1 (goodreads_rating, amazon_rating, romance_io_spice) → Tier 2 (goodreads_detail, metadata) → Tier 3 (author_crawl, spotify_playlists, reddit_buzz, discussion_links). Newest jobs first within each tier.
- Cron worker runs every 10 minutes (`/api/cron/enrichment-worker`)
- `enrichment_status` on books table: "pending" → "partial" → "complete"
- Book detail pages poll for updates when enrichment is incomplete
- **Grab pipeline queues enrichment at grab time (awaited) AND kicks off the worker immediately** (fire-and-forget `processEnrichmentQueue(30_000)`) so data is ready within seconds, not at the next 10-min cron tick
- **Hotlist pages poll** `/api/books/refresh-batch` every 8s when `enrichment_status` is not "complete" (and not null), auto-stopping when all books reach "complete"
- Enrichment banner shows above the hotlist table while books are being enriched
- **Daily caps**: on-demand `ai_synopsis` and `ai_recommendations` check daily completion counts before calling LLM APIs (prevents runaway costs). Counts actual data rows, not queue entries. Configurable via env vars. Fails safe (returns Infinity on count error).
- **Author crawl guard**: `author_crawl` jobs filter out non-romance books using `isRomanceByGenres()` before ingestion

### On-demand AI enrichment
- **AI synopsis**: `POST /api/books/synopsis` — triggered client-side from `OnDemandSynopsis` component on book detail page when book has description but no `ai_synopsis`. Shows skeleton loading state. Falls back to Goodreads description on failure.
- **AI recommendations**: `POST /api/books/recommendations` — triggered fire-and-forget from `BookDetailClient` enrichment poller. Current visit uses trope/author fallback; next visit gets cached AI recs.
- Both use Haiku with daily limits (default 50 synopsis, 25 recommendations). Limits count actual rows in `books` (synopsis) and `book_recommendations` tables using UTC day boundary.

### Files
- `/lib/enrichment/queue.ts` — queue management (add, fetch, complete, fail)
- `/lib/enrichment/worker.ts` — job processor (dispatches to appropriate enrichment function)
- `/app/api/cron/enrichment-worker/route.ts` — cron endpoint
- `/app/api/books/refresh-batch/route.ts` — batch book hydration endpoint (used by hotlist polling)
- `/app/api/books/synopsis/route.ts` — on-demand AI synopsis generation
- `/app/api/books/recommendations/route.ts` — on-demand AI recommendations generation
- `/app/book/[slug]/OnDemandSynopsis.tsx` — client component for on-demand synopsis with loading state

## Cron Jobs (vercel.json)

| Path | Schedule | Purpose |
|------|----------|---------|
| `/api/cron/enrichment-worker` | Every 10 min | Process pending enrichment queue jobs |
| `/api/cron/spice-backfill` | Every 6 hours | **PAUSED** — returns stub response. LLM spice inference + review classifier moved to on-demand/paused. |
| `/api/cron/refresh-spice` | Daily 4 AM UTC | Re-aggregate community signals, queue stale romance_io re-scrapes, recompute genre bucketing |
| `/api/cron/new-releases-discovery` | Daily 5 AM UTC | Google Books new romance releases |
| `/api/cron/seed-lists` | Daily 6 AM UTC | Seed/refresh curated book lists |
| `/api/cron/amazon-bestsellers` | Daily 7 AM UTC | Discover Amazon romance bestsellers via Serper |
| `/api/cron/openlibrary-discovery` | Daily 4 AM UTC | Discover new books via Open Library |
| `/api/cron/reddit-discovery` | Fridays 6 AM UTC | Reddit romance community buzz (Serper + Haiku title extraction) |
| `/api/cron/author-expansion` | Mondays 3 AM UTC | Crawl bibliographies for known authors |
| `/api/cron/weekly-refresh` | Tuesdays 10 AM UTC | Refresh stale book data |
| `/api/cron/monthly-enrichment` | 1st of month 2 AM UTC | Bulk enrichment pass |
| `/api/cron/spice-gap-monitor` | 1st of month 3 AM UTC | Audit spice coverage gaps, re-queue missing signals |
| `/api/cron/data-hygiene` | Sundays 2 AM UTC | Remove junk book entries (scraping artifacts, summaries, box sets, non-books) |
| `/api/cron/quality-pipeline` | Sundays 3 AM UTC | Auto-fixer, feedback→flags, quality scorecard, regression detector |
| `/api/cron/search-eval` | Sundays 4 AM UTC | Tier 1 search quality + DB ground truth audit (zero AI cost) |
| `/api/cron/quality-scanner` | Daily 3 AM UTC | Haiku semantic scanner (synopsis quality, series sanity, spice mismatch) |

**GitHub Actions (not Vercel):**

| Workflow | Schedule | Purpose |
|----------|----------|---------|
| `audit-harness.yml` | Sundays 5 AM UTC | Playwright browser audit: cover rendering, layout, enrichment stalls, audiobook detection. Pushes P0/P1 to `quality_flags`. |

All cron endpoints require `Authorization: Bearer $CRON_SECRET`.

## Database Strategy

### Philosophy
Hotlist acquires books through **multiple automated discovery channels** that run daily/weekly, then enriches every book through a **unified async enrichment queue**. No single source is critical — if one breaks, the others keep the catalog growing. All discovery runs through Vercel crons with cost controls.

### Discovery channels (how books enter the DB)

| Channel | Frequency | Source | How it works | Est. cost |
|---------|-----------|--------|-------------|-----------|
| **BookTok grabs** | On-demand | User-submitted videos | Two-phase Haiku+Sonnet pipeline extracts books from video | ~$0.03/grab |
| **Amazon bestsellers** | Daily | Serper → Amazon | Scrapes Amazon romance bestseller lists via Serper, resolves to Goodreads | ~$0.01/run |
| **New releases** | Daily | Google Books API | Queries Google Books for recent romance/romantasy releases | Free |
| **Open Library** | Daily | Open Library API | Discovers new romance books from Open Library subjects | Free |
| **Author expansion** | Weekly | Goodreads scraping | Crawls full bibliographies of authors already in DB, romance-gated | Free (scraping) |
| **Seed lists** | Daily | Curated | Refreshes editorial/curated book lists | Minimal |
| **Reddit buzz** | Weekly (Fri) | Serper + Haiku | Scans r/RomanceBooks, r/Romantasy, r/romancelandia, r/Fantasy for book mentions. Haiku extracts titles from snippets. | ~$0.05/run |
| **Harvest (extension)** | On-demand | Chrome extension | Admin scans Goodreads lists, Amazon categories, romance.io pages. Batch upload via `/api/seed/harvest`. Pre-captures ratings + spice. | Free |

### Enrichment pipeline (how books get data)

Every discovered book enters the `enrichment_queue`. The enrichment worker (every 10 min) processes jobs in priority order:

- **Tier 1** (ratings + spice): goodreads_rating, amazon_rating, romance_io_spice
- **Tier 2** (metadata): goodreads_detail, metadata (Google Books + Open Library)
- **Tier 3** (bonus): spotify_playlists

LLM-based jobs (ai_synopsis, ai_recommendations) are now **on-demand** — triggered when a user visits a book detail page. Other LLM jobs (trope_inference, review_classifier, llm_spice, booktrack_prompt) are **paused** (high coverage already achieved: synopsis 98%, review_classifier 96%, booktrack_prompt 83%).

Each job retries up to 3× with exponential backoff. Books progress through `enrichment_status`: pending → partial → complete.

**Canon gate:** When a book reaches `enrichment_status = 'complete'`, the canon gate (`/lib/books/canon-gate.ts`) evaluates whether it should be promoted to `is_canon = true`. Requirements: passes romance check OR adjacent-genre check (fantasy, gothic, dark academia, vampires, mythology, etc. with GR rating count >= 500), has cover + GR ID, no open P0 quality flags. The adjacent-genre gate allows popular crossover titles (Legendborn, Babel, A Dowry of Blood) that BookTok romance readers commonly read. Non-canon books are invisible on public surfaces. The enrichment worker skips `spotify_playlists` for non-canon books to prevent wasted spend — scraping/metadata jobs still run since they help determine canon eligibility.

### Spice quality assurance

The **spice gap monitor** (monthly) audits spice coverage:
1. Books with zero spice signals → re-queues romance_io + llm_spice
2. Top 500 books missing romance.io → re-queues romance_io_spice
3. Hierarchy violations (romance.io vs LLM disagreement >2.0) → logged
4. Books stuck at genre-bucketing only → re-queues for upgrade

### Data quality pipeline

Quality runs as a **Sunday pipeline** of 4 sequential crons (2-5 AM UTC), plus a daily Haiku scanner and a weekly Playwright audit. Each system is independent — if one fails, the others still run.

#### Sunday pipeline execution order

1. **Data hygiene** (2 AM) — Junk removal, dedup, series orphan detection. Zero API cost.
2. **Quality pipeline** (3 AM) — Auto-fixer, feedback→flags, scorecard, regression detector.
3. **Search eval** (4 AM) — Deterministic search checks + DB ground truth audit. Zero AI cost.
4. **Browser audit** (5 AM, GitHub Actions) — Playwright visual checks against production.

#### Layer 1: Write-time prevention

- `saveGoodreadsBookToCache()` and `saveProvisionalBook()` in `cache.ts` use `normalizeTitle()` to deduplicate at write time. When dedup finds a provisional entry (`goodreads_id: null`) matching the incoming Goodreads data, it upgrades the provisional with the GR ID, description, series info, and cover — preventing Google Books dupes from persisting alongside canonical Goodreads entries.
- `isCompilationTitle()` in `utils.ts` filters box sets before they enter curated rows
- `isJunkTitle()` in `romance-filter.ts` catches box sets with embedded book lists (e.g., "1 To 6 Book series Title1, Title2... by Author")
- `resolveExistingBook()` in `cache.ts` — shared dedup resolver checks GR ID, ISBN, Google Books ID, then normalized title+author before any insert
- Canon gate (`/lib/books/canon-gate.ts`) — books must pass romance check OR adjacent-genre check (fantasy, gothic, dark academia, etc. with GR rating count >= 500), have cover + GR ID, no open P0 flags before `is_canon = true`
- Enrichment worker skips `spotify_playlists` for non-canon books to prevent wasted spend (LLM jobs now on-demand/paused)

#### Layer 2: Data hygiene (weekly cleanup)

The data hygiene cron detects and removes junk entries that slip through prevention. SQL pattern matching only.

**What it catches:** garbled scraping artifacts (`[By: Author]`, `[AudioCD]`), study guide parasites, non-book entries, box sets/compilations, "Title by Author" Unknown Author dupes, series page entries.

**Safety:** Never deletes books with user data (hotlists, ratings) unless a canonical version exists to migrate refs to. Logs everything.

#### Layer 3: Rules engine + Haiku scanner

- **Rules engine** (`/lib/quality/rules-engine.ts`) — 8+ structural rules that fire on book writes. Detects: edition artifacts in titles/series, implausible page counts, junk patterns, missing data. Some rules are `auto_fixable` with `suggested_value`.
- **Haiku scanner** (`/lib/quality/haiku-scanner.ts`) — 4 semantic checks: series name sanity, synopsis quality, spice/genre mismatch, wrong Goodreads ID. Daily cap. Runs via `/api/cron/quality-scanner`.

#### Layer 4: Quality pipeline (weekly)

Runs as `/api/cron/quality-pipeline` (Sundays 3 AM):

1. **Auto-fixer** (`/lib/quality/auto-fixer.ts`) — Applies `suggested_value` from quality flags where `auto_fixable = true AND confidence >= 0.9`. Marks flags `auto_fixed`.
2. **Feedback pipeline** (`/lib/quality/feedback-pipeline.ts`) — Two functions: (a) `processGrabFeedback()` converts `grab_feedback` entries into quality flags (3+ reports → P0 + auto-demote), (b) `processGrabCorrections()` parses user correction notes ("I, Medusa by Ayana Gray"), searches for the correct book, updates `video_grabs.extracted_books` JSONB, and adds the book to the associated hotlist. Creates provisional books from Google Books if needed.
3. **Quality scorecard** (`/lib/quality/scorecard.ts`) — Computes coverage metrics (cover, synopsis, ratings, spice, tropes, ASIN, recommendations) + flag counts + enrichment status. Stored in `quality_health_log` for trend tracking.
4. **Regression detector** (`/lib/quality/regression-detector.ts`) — Groups recent books by `discovery_source`, runs rules engine on batches of 10+. Warns if any batch has >3 P0 flags.

#### Layer 5: Search eval (weekly)

Runs as `/api/cron/search-eval` (Sundays 4 AM). Zero AI cost.

- **Tier 1 (search quality):** Searches for 15 ground-truth bestsellers via `searchBooksInCache()`, asserts correct book ranks in top 3, validates rating accuracy within ±0.3 of canonical values.
- **DB audit:** Checks 20 ground-truth books exist in DB with GR ID, cover, enrichment complete, and accurate ratings.
- Results stored in `quality_health_log.search_eval` JSONB column.

Library: `/lib/quality/search-eval.ts`. Full manual harness with Sonnet Tier 3: `scripts/search-eval.ts`.

#### Layer 6: Browser audit (weekly, GitHub Actions)

Runs via `.github/workflows/audit-harness.yml` (Sundays 5 AM). Playwright against production.

- 11 structural checks per book: cover presence + aspect ratio (audiobook detection), rating accuracy, spice plausibility, synopsis quality, series name sanity, title cleanliness, foreign edition detection, enrichment stall indicators.
- Optional Haiku visual checks on failures.
- `--push-to-db` writes P0/P1 findings to `quality_flags`.
- Known bug regression tests (BUG-001 through BUG-008).

Script: `scripts/audit-harness.ts`. Requires GitHub repo secrets for Supabase + Anthropic.

#### Quality tables

| Table | Purpose |
|-------|---------|
| `quality_flags` | Issue tracking: book_id, field_name, issue_type, source, priority (P0-P3), confidence, auto_fixable, status (open/resolved/auto_fixed/dismissed) |
| `quality_health_log` | Weekly snapshots: canon count, coverage percentages, flag counts, enrichment status, search eval results |
| `serper_query_cache` | Caches Serper results to avoid re-querying known misses. 30-day TTL. Books with 3+ "no_data" results skipped entirely. |

#### Serper query cache

Before any Serper call in `romance-io-search.ts`, the cache is checked (`/lib/scraping/serper-cache.ts`). Books that returned "no_data" 3+ times are skipped entirely (`shouldSkipQuery()`). Saves ~20-30% of Serper budget on books genuinely not on romance.io.

#### Key files
- `/lib/books/data-hygiene.ts` — junk detection + cleanup
- `/lib/quality/rules-engine.ts` — structural quality rules
- `/lib/quality/haiku-scanner.ts` — semantic AI checks
- `/lib/quality/auto-fixer.ts` — applies auto-fixable flag suggestions
- `/lib/quality/feedback-pipeline.ts` — user feedback → quality flags
- `/lib/quality/scorecard.ts` — coverage metrics + trend tracking
- `/lib/quality/regression-detector.ts` — batch P0 spike detection
- `/lib/quality/search-eval.ts` — automated search + DB audit
- `/lib/scraping/serper-cache.ts` — Serper query dedup cache
- `/lib/books/canon-gate.ts` — canon promotion/demotion logic
- `scripts/audit-harness.ts` — Playwright browser audit (manual + GitHub Actions)
- `scripts/search-eval.ts` — full 3-tier search eval (manual, includes Sonnet Tier 3)

#### Admin quality dashboard

`/admin/quality/` — Admin-only page for quality triage and monitoring. Requires `is_admin` on profiles.

**Widgets (top of page):**
- **Stats cards** — Open flags, auto-fixable count, confirmed count, dismissed count
- **Quality Scorecard** — 8 coverage bars (covers, synopsis, GR rating, AMZ rating, romance.io spice, tropes, Amazon ASIN, AI recs) with %, enrichment status breakdown, flag counts by priority. Data from `/api/admin/quality/scorecard`.
- **Enrichment Source Health** — Per-source success/no-data/failure rates over last 24h with red warnings below 30%. Data from `/api/admin/quality/health`.
- **Recent Auto-Fixes** — Last 10 auto-fixed flags showing book, issue type, original→fixed values. Data from flags API filtered by `status=auto_fixed`.

**Flag triage table:**
- Filterable by status, priority, issue type. Paginated (50/page).
- Inline actions: Fix (apply suggested value), Confirm, Dismiss, Retag (reclassify issue type).
- Bulk "Auto-fix All" for high-confidence fixable flags on current page.
- "Run Full Scan" triggers rules engine on all books.

**API routes:**
- `GET /api/admin/quality/flags` — paginated flag list with book details
- `POST /api/admin/quality/flags` — create manual flag (auto-demotes on wrong_book/junk_entry, re-queues on bad_synopsis/rating_accuracy)
- `POST /api/admin/quality/flags/[id]/resolve` — confirm/dismiss with optional fix apply. Supports `newGoodreadsId` param for wrong_book/wrong_edition/foreign_edition flags — remaps the book to the correct GR ID, clears stale GR data, deletes old GR rating, re-queues goodreads_detail + goodreads_rating enrichment. Dupe-checks before remapping.
- `POST /api/admin/quality/flags/[id]/retag` — reclassify issue type
- `POST /api/admin/quality/flags/bulk-resolve` — batch resolve
- `GET /api/admin/quality/scorecard` — on-demand quality metrics
- `GET /api/admin/quality/health` — enrichment source health (24h)
- `POST /api/admin/quality/scan` — trigger full rules engine scan

### Amazon enrichment (bulk, ad-hoc)

For bulk ASIN lookups beyond what the daily enrichment worker handles, use the Apify `junglee~free-amazon-product-scraper` actor via scripts in `/scripts/amazon-enrichment/`. This is run manually when needed (e.g., after a large book import). The enrichment worker handles ongoing Amazon rating lookups via Serper.

### Serper query patterns

| Target | Query format | Notes |
|--------|-------------|-------|
| Amazon rating | `site:amazon.com "{title}" "{author}"` | 3-strategy fallback in `amazon-search.ts` |
| Romance.io spice+tags | `site:romance.io "{title}" "tagged as"` | Anchors on tag section for spice + tags |
| Romance.io rating | `site:romance.io "{title}" "of 5 stars"` | Follow-up query, only when first query missed the star rating |
| Goodreads genres | `site:goodreads.com "{title}" {author} "genres"` | Best coverage (7.5 avg shelves/book) |
| Reddit mentions | `site:reddit.com/r/RomanceBooks ...` | 9 queries across 4 subreddits |
| Discussion links (RomanceBooks) | `site:reddit.com/r/RomanceBooks "{title}" "{author}"` | Top 3 threads |
| Discussion links (Fantasy) | `site:reddit.com/r/Fantasy "{title}" "{author}"` | Top 2 threads |
| Discussion links (blogs) | `"{title}" "{author}" review OR discussion -site:amazon.com -site:goodreads.com` | Top 2 blog/podcast results |

### Key decisions
- **No Goodreads Apify actor needed** — Serper + direct scraping covers our needs at lower cost
- **Kindle Unlimited status paused** — no reliable detection method found (Amazon puts KU promo text on ALL pages, Apify free actor returns null prices for all Kindle editions)
- **`discovery_source` column** tracks how each book entered the DB (e.g., `reddit_mention`, `amazon_bestseller`, `booktok_grab`, `author_crawl`)
- **Cost target**: <$5/month total for all automated discovery + enrichment

## Buzz Scoring System

Books are ranked for the "What's Hot" carousel using a composite buzz score computed from multiple discovery signals. The system is analogous to composite spice — multiple weighted sources, time-decayed.

### How it works

1. **Signal recording**: Every discovery channel records a `book_buzz_signals` row when it encounters a book (even if already in DB). One signal per book per source per day.
2. **Scoring**: `getTopBuzzBooks()` in `/lib/books/buzz-score.ts` computes a time-decayed weighted score across all signals from the last 30 days.
3. **"What's Hot" integration**: `getWhatsHot()` in `app/page.tsx` pulls top buzz books as candidates alongside NYT bestsellers. Final sort uses buzz score as the primary factor, with enrichment quality as tiebreaker.

### Signal weights and decay

| Source | Weight | Where recorded |
|--------|--------|----------------|
| `nyt_bestseller` | 5.0 | `nyt-lists.ts` — on every NYT bestseller fetch |
| `booktok_grab` | 3.0 | `creators/register.ts` — on every BookTok grab |
| `amazon_bestseller` | 2.0 | `amazon-bestseller-discovery.ts` — daily bestseller scan |
| `reddit_mention` | 1.5 | `reddit-discovery.ts` — weekly Reddit scan |

- **Time decay**: Half-life of 7 days (signal loses 50% value every 7 days)
- **Diversity bonus**: Books with signals from 2+ different sources get a 1.5x multiplier
- **Lookback**: 30 days

### Files
- `/lib/books/buzz-signals.ts` — `recordBuzzSignal()`, `recordBuzzSignalsBatch()` — write helpers
- `/lib/books/buzz-score.ts` — `getTopBuzzBooks()`, `getBuzzScoresForBooks()` — scoring engine

## Reader Response System

Users express opinions about books through `ReaderResponse` — a unified pre/post-read response type stored in `reading_status`:

| Response | Category | Meaning |
|----------|----------|---------|
| `must_read` | Pre-read | Want to read this book |
| `on_the_shelf` | Pre-read | Aware of it, maybe later |
| `not_for_me` | Pre-read | Not interested |
| `loved_it` | Post-read | Read and loved (4-5 stars equivalent) |
| `it_was_fine` | Post-read | Read, it was okay (3 stars equivalent) |
| `didnt_finish` | Post-read | Started but didn't finish (1-2 stars equivalent) |

- **API**: `setReaderResponse()` in `lib/reading-status.ts` — upserts reading_status + dual-writes legacy `status` column
- **UI**: `ReaderResponse.tsx` component with pre-read/post-read toggle
- **Onboarding integration**: All three onboarding paths use ReaderResponse to capture user preferences and auto-create Hotlists from `must_read` / `loved_it` picks

## Onboarding Paths

Three converging paths at `/get-started`, all ending with a Hotlist + DNA progress:

1. **Rate Books** (`/get-started/rate`) — Grid of 30 popular canon books. `BookPicker` component with 🔥/📚/🤷 buttons. Min 10 ratings to continue. Auto-creates "My Must Reads" Hotlist.
2. **Goodreads Import** (`/get-started/import`) — Drag-drop CSV upload. `GoodreadsImporter` parses CSV client-side, sends to API for batch matching (goodreads_id → ISBN → title+author). Review matched books with editable response selectors. Auto-creates "My Goodreads Favorites" Hotlist.
3. **Follow Creators** (`/get-started/creators`) — Search BookTok creators by handle, select 1+, see their top books ranked by mention overlap. Rate books + auto-follow creators. Auto-creates "Creator Picks" Hotlist.

**DNA Progress Bar** (`DnaProgressBar.tsx`): Fire gradient bar showing progress toward 25-book Reading DNA unlock. Renders on profile page, reading list, post-onboarding redirect.

## Hotlist Share Cards

Branded OG images for Hotlists, generated via satori (`next/og`):

- **Data helper**: `lib/hotlist-share-data.ts` — `getHotlistShareData(shareSlug)` fetches name, first 5 covers, spice range (composite min/max), top 3 shared tropes, owner name, creator handle
- **OG Image route**: `app/api/hotlists/[shareSlug]/og-image/route.tsx` (Edge runtime) — `?size=og` (1200x630) or `?size=stories` (1080x1920). Dark gradient background matching creator share card palette.
- **Share sheet**: `HotlistShareSheet.tsx` — bottom sheet with Copy Link, Download Image (stories-sized), native Share (navigator.share with clipboard fallback)
- **OG metadata**: Public hotlist pages include `openGraph.images` and `twitter:card` meta tags pointing to the OG image route

## Reading DNA & For You Pipeline

The Reading DNA system lets users take a 60-second test to build a preference profile, which powers personalized recommendations.

### DNA Test Flow (`/reading/dna`)
6-step wizard: subgenre → spice (multi-select) → tropes → books (search-first) → disliked books → content warnings. Spice supports multiple selections (e.g., levels 3 and 4), producing a preferred level + tolerance range. Book pick step uses search + smart suggestions (series > author > trope overlap + popularity tiebreaker). Suggestion grid stays stable when picking from it (only refreshes on search picks). Optional steps show "Skip" when empty, "Next" when selections made. Draft persists to `sessionStorage` for OAuth redirect survival.

### DNA Scoring (`/lib/reading-dna/score.ts`)
- **Trope score**: dot product of user's `tropeAffinities` × book's trope vector
- **Spice multiplier**: Gaussian penalty (0.3–1.0) based on distance from preferred spice, shaped by tolerance. Books with wrong spice keep at most 30% of their trope score. Books without spice data scored neutrally (1.0).
- **Final score**: `tropeOverlap × spiceMultiplier`
- `reRankByDna()`: blends DNA score (30%) with original ranking (70%) for search results

### For You Homepage (`/api/homepage/for-you`)
- Fetches user's DNA via `getDna()`
- Scores ALL `book_trope_vectors` against DNA profile using `rankBooks()`
- Hydrates top 20, filters to canon books with covers + tropes, returns top 10
- `PersonalizedShell` renders `ForYouRow` (if DNA exists) or `DnaCtaBanner` (if not)

### Results Page (`/reading/dna/results`)
After test completion, shows DNA profile (AI blurb, subgenres, tropes, spice) + "Does this sound like you?" with a preview of For You recommendations. "Yes! Show me more" → homepage. "Not quite — retake" → restart test.

## Source Attribution Standard

**Rule**: If we show a number, score, or data point from an external source, the user must be able to reach the source page for that book in one click. We are a layer on top of these sources, not a replacement.

| Source | Data type | Links to |
|--------|----------|----------|
| **Goodreads** | Rating, review count, description | `goodreads.com/book/show/{goodreadsId}` |
| **Romance.io** | Rating, spice level, tropes | `romance.io/books/{romanceIoSlug}` or search fallback |
| **Amazon** | Rating | `amazon.com/dp/{asin}?tag={affiliateTag}` or search fallback |
| **Hotlist community** | Spice rating, star rating | No external link (our own data) |
| **AI inference** | Synopsis, estimated spice | No external link, labeled "AI-generated" |

**Visual treatment**: Small `↗` arrow on external-linked ratings. Consistent `hover:text-fire` on all source links. `RatingBadge` has an `external` prop that shows a small ExternalLink icon.

**Surfaces implemented**:
- Book detail page: All RatingBadges are clickable links. "See reviews on Goodreads ↗" below ratings. Goodreads description fallback shows "Description from Goodreads ↗".
- Hotlist comparison table (desktop + mobile): All rating columns (GR, AMZ, RIO) are clickable links with ↗ arrows. Spice peppers link to romance.io when `primarySource === "romance_io"`.
- SpiceSection on book detail: Already linked via SpiceAttribution.

## Coding style
- TypeScript everywhere
- Server components by default; use `'use client'` only when needed
- Prefer Supabase RLS over API route auth checks
- Use `zod` for all API input validation
- Meaningful variable names — this codebase may be read by a non-engineer
- Comment complex logic clearly
