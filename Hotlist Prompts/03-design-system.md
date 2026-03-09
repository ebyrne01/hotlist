# Prompt 03 — Design System & App Shell

> **Before you run this**: Make sure `npm run dev` is running and you can see the site at localhost:3000.

---

Now let's build the visual design system and the app shell (the navigation and layout that wraps every page).

## Brand reference
- **Name**: Hotlist 🔥
- **Tagline**: "Your next great read, already waiting."
- **Colors**: fire `#d4430e`, cream `#faf7f2`, ink `#12080a`, muted `#7a6055`, gold `#b07d2a`, border `#e0d2c8`
- **Fonts**: Playfair Display (headings), Libre Baskerville (body), DM Mono (labels/mono)
- **Tone**: warm, editorial, slightly literary — like a well-curated independent bookshop

## 1. Create UI primitive components

Create these reusable components in `/components/ui/`:

**`/components/ui/Button.tsx`**
- Variants: `primary` (fire background, white text), `secondary` (white, ink border), `ghost` (transparent, muted)
- Sizes: `sm`, `md`, `lg`
- Should accept an optional `icon` prop
- Mobile-friendly touch targets (min 44px height)

**`/components/ui/Badge.tsx`**
- For trope tags, source labels, status indicators
- Variants: `trope` (gold), `fire` (fire color), `muted` (grey), `included` (fire, solid), `excluded` (red, strikethrough text)

**`/components/ui/SpiceIndicator.tsx`**
- Shows 1-5 chili pepper emojis 🌶️
- Accepts `level` (1-5) and `source` ('romance_io' | 'community')
- Greys out unlit peppers
- Small tooltip showing source on hover

**`/components/ui/StarRating.tsx`**
- Shows 1-5 stars
- Two modes: `display` (read-only) and `interactive` (clickable to set rating)
- Gold color for filled stars

**`/components/ui/RatingBadge.tsx`**
- Shows a numeric score (e.g. "4.2") with a source label below ("Goodreads")
- Used in the Hotlist comparison table

**`/components/ui/BookCover.tsx`**
- Displays a book cover image with fallback
- If no cover URL, shows a styled placeholder with title initial
- Accepts sizes: `sm` (40x60px), `md` (80x120px), `lg` (120x180px)

## 2. Create the app shell

**`/components/layout/Navbar.tsx`**
- Left: "Hotlist 🔥" wordmark (Playfair Display, fire color)
- Center: search bar (compact, expands on focus) — for desktop only
- Right: 
  - If logged out: "Sign In" button (ghost style)
  - If logged in: avatar/initials circle + dropdown with "My Hotlists", "Reading List", "Sign Out"
- Mobile: hamburger menu with the above links
- Sticky at top, cream background, subtle border-bottom
- On mobile: search icon that opens full-width search

**`/components/layout/Footer.tsx`**
- Simple dark footer with "Hotlist 🔥" wordmark
- Links: About, Privacy, Terms, Join Pro Waitlist
- Copyright line
- Keep it minimal

## 3. Create the root layout

Update `/app/layout.tsx` to:
- Use the Navbar and Footer
- Set correct HTML lang and metadata (title "Hotlist — Find your next romance read", description as tagline)
- Add the Google Fonts link
- Wrap children in a `<main>` tag with appropriate padding
- Handle Supabase auth session provider

## 4. Create a loading skeleton component

**`/components/ui/BookCardSkeleton.tsx`**
- Animated shimmer placeholder for when books are loading
- Same dimensions as a book card
- Use Tailwind's `animate-pulse`

After building all of this, run the app and take a screenshot or tell me what I should see. The site should now have a proper navbar, footer, and brand styling — even though the homepage content is still empty.
