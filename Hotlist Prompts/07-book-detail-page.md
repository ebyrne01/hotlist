# Prompt 07 — Book Detail Page

> The most important page in the app. This is where users get the full picture 
> on a book before deciding to add it to their Hotlist.

---

Build the book detail page at `/app/book/[slug]/page.tsx`.

## URL structure
- Each book has a slug like `slug like a-court-of-thorns-and-roses-17675462 generated from ${slugify(title)}-${goodreads-id} — look up the book by extracting the Goodreads ID from the end of the slug
- Generated from: `${slugify(title)}-${slugify(author)}`
- The page looks up the book from Supabase using the slug, or falls back to ISBN/Google Books ID

## Page layout (desktop: 2-column, mobile: single column)

### Left column (1/3 width on desktop)
- Book cover image (large, BookCover component)
- Metadata list:
  - Author (link to author search)
  - Series (if applicable): "Book 1 of [Series Name]"
  - Published year
  - Pages
  - Publisher
- **Buy buttons** (stacked):
  - "Buy on Kindle →" (Amazon affiliate link, fire button)
  - "Buy in Print →" (Amazon affiliate link, secondary button)
- **Reading status** (if logged in):
  - Three buttons: "Want to Read" | "Reading" | "Read"
  - Active status highlighted in fire color
  - Clicking sets status in Supabase

### Right column (2/3 width on desktop)

**Book title** — large Playfair Display, with series info below if applicable

**Ratings row** — three RatingBadge components side by side:
- Goodreads: score + "Goodreads" label
- Amazon: score + "Amazon" label  
- romance.io: score + "romance.io" label
- Each shows "—" if data not yet available, with a small loading spinner
- Below ratings: total review count for each source

**Spice level** — SpiceIndicator component:
- Shows romance.io spice level with "romance.io" tooltip
- If community data available (≥5 ratings): show second row "Hotlist readers: 🌶️🌶️🌶️🌶️"
- If no data: "Spice level unavailable"

**Trope tags** — clickable cloud of Badge components:
- Each trope is clickable → navigates to `/tropes/[slug]`
- Show "included" style by default
- If user is on the search page with filters, excluded tropes show strikethrough

**AI Synopsis** — Playfair Display italic, 3-4 sentences:
- Labeled "About this book" in DM Mono
- If generating: show skeleton with "Generating synopsis..." text
- Small "✨ AI-generated" label beneath in muted style

**Add to Hotlist CTA**:
- Prominent fire-colored button: "🔥 Add to Hotlist"
- If logged out: shows sign-in modal on click
- If logged in: shows a dropdown/popover listing user's hotlists + "New Hotlist" option

**User rating widget** (logged in only):
- Appears after "Add to Hotlist" button
- Star rating (1-5, interactive)
- Spice rating (1-5 chili peppers, interactive)  
- Optional note field (textarea, placeholder: "Your private reading note...")
- "Save Rating" button
- Shows existing rating if already rated

**Review highlights** (below the main info):
- Tabs: "Goodreads" | "Amazon" | "romance.io"
- 2-3 curated review snippets per source (scraped)
- Each shows: quote, star rating, "See full review →" link to original
- Note at bottom: "Reviews from [Source]. Hotlist shows highlights only."

**Readers also loved**:
- Horizontal scroll of BookCards
- Books sharing the most tropes with this book
- Query: SELECT books WHERE tropes overlap most, ordered by rating

## Loading and error states
- While book data loads: show full-page skeleton layout
- If book not found: friendly 404 with "Search for another book" CTA
- If ratings are loading (being scraped): show ratings area with spinners, auto-refresh every 5 seconds until data arrives

## SEO
- Dynamic metadata: title = "Book Title by Author — Hotlist", description = first 155 chars of synopsis
- Open Graph image: book cover + title + rating info (for social sharing)
- Structured data (JSON-LD) for the book

## Mobile layout
- Cover image + title + buy buttons at top
- Ratings in a horizontal scroll row
- Everything else stacked below
- Sticky "Add to Hotlist" button at the bottom of the screen

Build this page and tell me to navigate to a book URL to test it.
