# Prompt 12 — Polish, Mobile & Edge Cases

> Before deploying, we make sure everything looks great on mobile,
> handles errors gracefully, and feels fast.

---

## 1. Mobile audit — fix these specific issues

Go through each page and fix mobile layout issues at 375px width:

**Navbar:**
- [ ] Logo + hamburger menu only on mobile (hide desktop search + nav links)
- [ ] Hamburger opens a slide-in drawer with: Search, Browse Tropes, My Hotlists (if logged in), Reading List (if logged in), Sign In / Profile
- [ ] Drawer closes on tap outside or ESC

**Homepage:**
- [ ] Hero section fits in one screen without scrolling on iPhone 14
- [ ] Horizontal scroll rows have visible scroll hints (gradient fade on right edge)
- [ ] Trope grid is 2 columns on mobile, not 5

**Search results:**
- [ ] Filter bar collapses to a "Filters" button on mobile
- [ ] Tapping "Filters" opens a bottom sheet with filter options
- [ ] Book grid is 2 columns on mobile

**Book detail:**
- [ ] Cover + title + buy buttons stack vertically at top
- [ ] Ratings in a 3-column grid (not side by side text)
- [ ] Sticky "Add to Hotlist" button at bottom of screen (fixed position)
- [ ] Review tabs are swipeable

**Hotlist table:**
- [ ] On mobile: show Book | Avg Rating | Spice | Buy as fixed columns
- [ ] Remaining columns in horizontal scroll
- [ ] Touch-friendly sort controls (not just tiny column headers)

## 2. Loading states everywhere

Make sure every data-fetching component has:
- A loading skeleton (not just a spinner)
- The skeleton matches the shape of the content (same height/layout)

Check these components have proper skeletons:
- [ ] BookCard (grid and list variants)
- [ ] Book detail page (left column + right column separately)
- [ ] HotlistTable (skeleton rows)
- [ ] Ratings badges (shimmer placeholder)
- [ ] Review highlights (text line skeletons)

## 3. Empty states

Every list/grid that can be empty needs a friendly empty state:

- **Search results with no results**: "No results for '[query]'. Try a different title, or browse by trope →"
- **Hotlist with 0 books**: "Add your first book to start comparing →" with search bar
- **Hotlist with 1 book**: "Add at least one more book to compare" 
- **Reading list tabs with 0 books**: Friendly message per tab, e.g. "Books you want to read will appear here"
- **No hotlists**: "Create your first Hotlist to start comparing books →"

## 4. Error handling

Create `/components/ui/ErrorMessage.tsx`:
- Generic error display component
- Shows a friendly message (not a stack trace)
- "Try again" button that refreshes the component
- For 404s: suggests searching or browsing tropes

Add error boundaries to:
- The search results page
- The book detail page
- The Hotlist table

## 5. Toast notifications

Create `/components/ui/Toast.tsx` and a toast system:
- Small notification in bottom-right corner (bottom-center on mobile)
- Auto-dismisses after 3 seconds
- Variants: success (green), error (red), info (muted)

Use toasts for:
- "Book added to [Hotlist Name] 🔥"
- "Rating saved ✓"  
- "Removed from Hotlist"
- "Link copied to clipboard"
- "You're on the waitlist! 🔥"
- Auth errors

## 6. Performance basics

- [ ] Add `next/image` to all book cover images (automatic optimization)
- [ ] Verify the homepage uses `loading="lazy"` for below-fold images
- [ ] Add `revalidate = 3600` (1 hour) to static trope pages
- [ ] Make sure the Hotlist comparison table doesn't re-fetch on every render (use SWR with proper keys)

## 7. Accessibility basics

- [ ] All interactive elements have visible focus states (fire-colored outline)
- [ ] Images have alt text ("Book cover for [Title] by [Author]")
- [ ] Color isn't the only way to communicate info (spice shows 🌶️ icons, not just color)
- [ ] The sign-in modal is keyboard navigable (Tab through buttons, Enter to activate)

## 8. Final visual check

Open each page and verify:
- [ ] Fonts are loading correctly (Playfair Display, Libre Baskerville, DM Mono)
- [ ] Brand colors are consistent (fire `#d4430e`, cream `#faf7f2`)
- [ ] No layout breaks at 375px (mobile), 768px (tablet), 1280px (desktop)
- [ ] Dark sections (hero, navbar) have good contrast
- [ ] Trope tags are readable and clickable

After completing this, the app should feel polished and production-ready.
