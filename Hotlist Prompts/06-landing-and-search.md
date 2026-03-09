# Prompt 06 — Landing Page & Search

> This builds the first thing users see: the homepage and search experience.
> Reference the design system we built in Prompt 03.

---

Build the landing page and search functionality.

## 1. Book card component

Create `/components/books/BookCard.tsx`:
- Shows: cover image, title, author, average rating (across all sources), spice indicator, top 2 trope tags
- Two layouts: `grid` (vertical card) and `list` (horizontal row)
- Clicking navigates to `/book/[slug]`
- "Add to Hotlist" button — if logged out, triggers sign-in modal; if logged in, shows hotlist picker
- Small fire badge 🔥 if book is in "What's Hot" (top rated this week)
- Loading skeleton version using `BookCardSkeleton`

## 2. Search

Create `/lib/search.ts`:
```
Function: searchBooks(query: string): Promise<Book[]>
- First: search Supabase full-text index (instant, from cache)  
- Simultaneously: call Google Books API
- Merge results, deduplicate by ISBN
- Return combined results, Supabase results first (they have richer data)
```

Create `/components/search/SearchBar.tsx`:
- Controlled input with debounce (300ms)
- Shows dropdown of results as user types (minimum 3 characters)
- Each result shows: cover thumbnail, title, author, rating if available
- Pressing Enter or clicking a result navigates to `/book/[slug]`
- Pressing Escape closes dropdown
- On mobile: full-screen search overlay

Create `/app/search/page.tsx`:
- Full search results page for when user hits Enter
- Shows grid of BookCard components
- Filter bar on the left (desktop) / collapsible top bar (mobile):
  - Trope filter (multi-select)
  - Minimum rating (1-5 slider)
  - Spice range (1-5, include/exclude)
  - Sort: Rating (high-low), Most Reviewed, Spice Level
- Loading state with skeletons
- Empty state: "No results for '[query]' — try a different title or author"

## 3. Homepage

Create `/app/page.tsx` — full homepage:

**Section 1: Hero**
- Dark background (ink color) with subtle radial gradient
- "Hotlist 🔥" wordmark in large Playfair Display
- Tagline: "Every rating. Every trope. One decision."
- Large search bar — this IS the main CTA
- Below search: small text "or browse by trope ↓"

**Section 2: What's Hot This Week**
- Horizontal scroll row of BookCards
- Data: top-rated books added/updated in the last 7 days from Supabase
- Section header: "🔥 What's Hot"

**Section 3: Browse by Trope**  
- Grid of trope pills — clicking navigates to `/tropes/[slug]`
- Show all 25 tropes from our seed data
- Make the most popular ones (enemies-to-lovers, slow burn, etc.) slightly larger

**Section 4: Spiciest Right Now**
- Another horizontal scroll row
- Books sorted by spice level (4-5 chili peppers)
- Section header: "🌶️ Turn Up the Heat"

**Section 5: For logged-in users only**
- If logged in: show "Your Active Hotlists" section with their current lists
- If logged out: show a simple "What is Hotlist?" explainer with 3 feature bullets and a "Sign up free" CTA

## 4. Trope browse page

Create `/app/tropes/[slug]/page.tsx`:
- Header: trope name in large Playfair Display italic
- Subheader: "X books tagged with enemies-to-lovers"
- Grid of BookCards filtered to this trope
- Sort options: Highest Rated, Most Spicy, Newest
- This page should be statically generated for SEO (use generateStaticParams for all 25 tropes)

## 5. Make it look great

The landing page should feel like walking into an independent bookshop — warm, content-rich, editorial. Not a SaaS product. No feature lists, no "why Hotlist" marketing section. Just beautiful books with great data.

Make sure:
- The hero section fills the viewport on desktop
- Everything is scrollable and readable on a 375px wide mobile screen
- Images load with a shimmer placeholder
- Font hierarchy is clear: display (Playfair) for headlines, body (Libre Baskerville) for text, mono (DM Mono) for labels/ratings

Tell me what the homepage looks like when I visit localhost:3000.
