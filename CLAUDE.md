# Hotlist 🔥 — Project Bible for Claude Code

## What is Hotlist?
A romance & romantasy book intelligence web app. Users search for books and get ratings from Goodreads, Amazon, and romance.io aggregated in one place, plus spice levels, trope tags, and an AI-generated synopsis. The signature feature is the "Hotlist" — a comparison table where users save multiple books side by side to decide what to read next. Affiliate buy links (Amazon) monetize the app.

## Audience
Romance and romantasy readers. Mobile-first. Non-technical users. The tone is warm, editorial, and a little spicy — never corporate.

## Tech Stack (do not deviate from this)
- **Framework**: Next.js 14 with App Router
- **Styling**: Tailwind CSS
- **Database + Auth**: Supabase (PostgreSQL + Supabase Auth)
- **Deployment**: Vercel
- **AI**: Anthropic Claude API — use `claude-haiku-4-5-20251001` for ALL in-app AI calls (synopsis generation, trope normalization, sentiment tagging). This model is called by the *running app*, not by Claude Code. It's cheap enough that generating thousands of synopses costs pennies.
- **Book metadata**: Google Books API (free, no key needed for basic use) + Open Library API
- **Data enrichment**: Web scraping via cheerio + node-fetch (Goodreads, Amazon). romance.io blocks scrapers — spice data is inferred from Goodreads shelf names instead.
- **State/data fetching**: SWR

## Future iOS app
The backend is Supabase. The iOS app (Expo/React Native, built later) will connect directly to Supabase using the same project. Do NOT couple business logic to Next.js API routes — put it in Supabase (RLS policies, database functions) wherever possible so the mobile app can reuse it without a proxy.

## Key principles
1. **Mobile-first**: Design every screen for 375px wide first
2. **No auth walls**: Browsing, search, and book detail pages are public. Auth only triggers when saving to a Hotlist or rating a book
3. **Speed**: Cache aggressively. Book data from external sources should be cached in Supabase for 24 hours minimum
4. **Cost control**: Use claude-haiku-4-5-20251001 for all AI. Batch scraping jobs. Cache everything.
5. **Graceful degradation**: If scraping fails, show what we have. Never show a broken page.

## Environment Variables needed
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
GOOGLE_BOOKS_API_KEY=
AMAZON_AFFILIATE_TAG=
NEXT_PUBLIC_APP_URL=
SERPER_API_KEY=              # from serper.dev (Google search API for romance.io spice + Amazon ratings)
RAPIDAPI_KEY=              # from rapidapi.com (video downloader)
RAPIDAPI_VIDEO_HOST=       # specific host for chosen downloader API
OPENAI_API_KEY=            # from platform.openai.com (Whisper transcription)
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
- Spice icon: 🌶️ (1-5 scale)
- Brand icon: 🔥

## Spice data sources (priority order)
1. `hotlist_community` — user ratings from Hotlist (most trusted, our data moat)
2. `goodreads_inference` — inferred from Goodreads shelf names (available immediately, lower precision)
3. No data — prompt user to rate

## Data sources — canonical hierarchy

| Source | Role | What it provides |
|--------|------|-----------------|
| **Goodreads** | Canonical identity | Book ID, title, author, cover, rating, genres, series, description |
| **Google Books** | Metadata supplement | ISBN, page count, publisher, high-res cover |
| **Open Library** | Metadata fallback | ISBN, page count, publisher (if Google Books misses) |
| **NYT Books API** | Discovery only | "What's Hot" row. Every NYT title resolved to Goodreads ID before storing. |
| **Amazon** | Affiliate links + rating | ASIN for buy links, ratings as supplementary data point |
| **Hotlist community** | Spice ratings (primary) | User-submitted 1-5 spice ratings — our data moat |
| **Goodreads shelf inference** | Spice ratings (fallback) | Inferred from shelf names. |

**Golden rule:** Goodreads ID is the canonical identity for fully enriched books.
Provisional entries (from Google Books) can exist without a Goodreads ID — the enrichment queue will resolve them.

## Data model summary
See `schema.sql` for full schema. Key tables:
- `books` — canonical book records (goodreads_id is UNIQUE but nullable for provisional entries)
- `enrichment_queue` — async enrichment jobs with retry logic (goodreads_detail, ratings, spice, etc.)
- `book_ratings` — per-source ratings (goodreads, amazon, romance_io)
- `book_spice` — spice ratings (hotlist_community, goodreads_inference)
- `book_tropes` — trope tags per book
- `hotlists` — user-created comparison lists
- `hotlist_books` — books within a hotlist
- `user_ratings` — user's personal star + spice rating
- `reading_status` — want_to_read / reading / read per user per book
- `homepage_cache` — cached book ID lists for homepage rows (24h TTL)
- `nyt_trending` — NYT bestseller list entries with rank + weeks_on_list

## File structure conventions
- `/app` — Next.js App Router pages
- `/app/api` — API routes (keep thin — logic goes in `/lib`)
- `/lib` — business logic, scraping, AI calls
- `/lib/books/` — book service modules:
  - `index.ts` — main entry point (findBook, getBookDetail, getBooksByTrope)
  - `goodreads-search.ts` — Goodreads scraping, search, genre check, slug generation
  - `cache.ts` — Supabase read/write, hydration helpers
  - `google-books.ts` — Google Books API
  - `open-library.ts` — Open Library API
  - `nyt-lists.ts` — NYT bestseller integration (discovery only)
  - `new-releases.ts` — Google Books new releases
  - `metadata-enrichment.ts` — supplementary metadata from Google/OL
  - `romance-filter.ts` — romance genre guard + junk title filter
  - `ai-synopsis.ts` — Claude-generated synopses
- `/lib/enrichment/` — async enrichment queue system
  - `queue.ts` — job queueing, fetching, status updates, retry logic with exponential backoff
- `/lib/scraping/` — per-site scrapers (Goodreads ratings, Amazon via Serper, spice inference)
  - `amazon-search.ts` — Amazon ratings via Serper Google search (replaces broken direct scraping)
  - `amazon.ts` — DEPRECATED: direct Amazon scraping (returns 503)
- `/components` — React components
- `/components/ui` — base UI primitives

## BookTok feature (formerly "Grab from Video")
- Video download: RapidAPI (third-party TikTok/Instagram/YouTube downloader)
- Transcription: OpenAI Whisper API (model: whisper-1) — NOT Claude
- **Vision extraction: Claude Haiku (claude-haiku-4-5-20251001) — reads book covers and on-screen text from video thumbnail**
- Book extraction: Claude Haiku (claude-haiku-4-5-20251001) — extracts titles from transcript
- **Title correction: Claude Haiku — corrects Whisper transcription errors in book titles/author names**
- Resolution: Fuzzy matching via PostgreSQL trigram search + Goodreads canonical lookup
- Cache: `video_grabs` Supabase table — never process the same URL twice
- Files: `/lib/video/` (downloader, transcription, vision-extractor, book-extractor, book-resolver, index)
- UI: `/app/booktok/page.tsx` (old `/app/grab/page.tsx` redirects here)
- API: `/app/api/grab/route.ts` (streaming)
- URL detection: SearchBar auto-detects video URLs and redirects to `/booktok?url=...`

### BookTok pipeline (in order):
1. Validate URL + check cache
2. Download video/audio via RapidAPI
3. Transcribe audio via Whisper (parallel with step 4)
4. Extract book covers from video thumbnail via Claude Haiku vision
5. Extract book mentions from transcript via Claude Haiku
6. Correct transcription errors via Claude Haiku
7. Merge vision + transcript books, deduplicate
8. Resolve each book: fuzzy trigram DB search → Goodreads search → unmatched
9. Cache result in `video_grabs` table

## Coding style
- TypeScript everywhere
- Server components by default; use `'use client'` only when needed
- Prefer Supabase RLS over API route auth checks
- Use `zod` for all API input validation
- Meaningful variable names — this codebase may be read by a non-engineer
- Comment complex logic clearly
