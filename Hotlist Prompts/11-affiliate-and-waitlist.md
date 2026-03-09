# Prompt 11 — Affiliate Links & Pro Waitlist

> Two key monetization pieces: Amazon affiliate buy links and 
> capturing email interest for Hotlist Pro before we build it.

---

## 1. Affiliate link system

Create `/lib/affiliate.ts`:

```
Function: buildAmazonLink(asin: string, format: 'kindle' | 'print'): string
- For Kindle: https://www.amazon.com/dp/{asin}?tag={AMAZON_AFFILIATE_TAG}&linkCode=ogi&th=1&psc=1
- For print: same URL structure
- If no ASIN available: return Amazon search URL for title+author with affiliate tag
- Always append the affiliate tag from environment variables

Function: buildAmazonSearchLink(title: string, author: string): string
- Fallback when we don't have an ASIN
- https://www.amazon.com/s?k={title}+{author}&tag={AMAZON_AFFILIATE_TAG}

Function: trackAffiliateClick(bookId: string, format: 'kindle' | 'print', source: 'book_detail' | 'hotlist_table')
- Log to Supabase affiliate_clicks table (create this table)
- Async, non-blocking — fire and forget
- This lets us see which books drive the most affiliate revenue
```

Create the `affiliate_clicks` table in Supabase:
```sql
create table affiliate_clicks (
  id         uuid primary key default uuid_generate_v4(),
  book_id    uuid references books(id),
  user_id    uuid references auth.users(id),  -- null if not logged in
  format     text check (format in ('kindle', 'print')),
  source     text,  -- 'book_detail' | 'hotlist_table'
  clicked_at timestamptz default now()
);
-- Public insert only (we want to track all clicks)
alter table affiliate_clicks enable row level security;
create policy "Anyone can log clicks" on affiliate_clicks for insert with check (true);
create policy "Service role reads clicks" on affiliate_clicks for select using (auth.role() = 'service_role');
```

## 2. Buy button component

Create `/components/books/BuyButtons.tsx`:

```tsx
// Two variants:
// 1. "stacked" — used on book detail page (vertical stack, full width)
// 2. "inline" — used in Hotlist table (single "Buy →" dropdown button)
```

**Stacked variant (book detail page):**
- "📱 Buy on Kindle →" — fire button, full width
- "📖 Buy in Print →" — secondary button, full width
- Small muted text: "Affiliate link — supports Hotlist"
- Both open in new tab
- Both call `trackAffiliateClick` before navigating

**Inline variant (Hotlist table):**
- Single button labeled "Buy →"
- On click: small dropdown with "Kindle" and "Print" options
- Compact — fits in a table cell

## 3. Kindle Unlimited badge

Create `/components/books/KindleUnlimitedBadge.tsx`:
- Simple badge: "✓ Kindle Unlimited" in green
- Only show if `book.is_kindle_unlimited === true`
- Note: we'll populate this field in a future scraping update
- For now, leave the field in the schema but don't show the badge (placeholder for Phase 2)

Add `is_kindle_unlimited boolean default null` to the `books` table.

## 4. Pro waitlist

Create `/lib/waitlist.ts`:

```
Function: joinProWaitlist(email: string, userId?: string): Promise<{ success: boolean, alreadyJoined: boolean }>
- Insert into pro_waitlist table (upsert — handle duplicate emails)
- If userId provided: also set profiles.pro_waitlist = true
- Return whether they were already on the list
```

Create `/components/waitlist/ProWaitlistBanner.tsx`:

A non-intrusive banner/card for the homepage (logged-out users) and profile page:

```
🔥 Hotlist Pro — Coming Soon

Unlimited Hotlists · Weekly "What's Hot" digest for your tropes · 
Series completion alerts

[email input field]  [Join the Waitlist →]

"Be first to know. No spam."
```

Behavior:
- Email input + submit button
- If user is logged in: pre-fill their email, hide the input, just show "Join Waitlist" button
- On submit: call `joinProWaitlist`, show success message "You're on the list! We'll be in touch. 🔥"
- Don't show banner again if they've already joined (store in localStorage)
- On the homepage: show as a section between "What's Hot" and the trope grid
- On profile page: show as a card if not yet on waitlist

Create `/app/api/waitlist/route.ts`:
- POST endpoint accepting `{ email, userId? }`
- Validates email with zod
- Calls `joinProWaitlist`
- Returns success/already-joined status

## 5. Simple analytics (free)

Add Vercel Analytics (it's free on Vercel):
```
npm install @vercel/analytics
```
- Add `<Analytics />` component to root layout
- This automatically tracks page views — no configuration needed
- View data in Vercel dashboard

## Test it

Tell me to:
1. Find a book detail page
2. Click "Buy on Kindle →" — should open Amazon in a new tab with affiliate tag in URL
3. Check Supabase → affiliate_clicks table — should see a new row
4. On the homepage, find the Pro waitlist banner
5. Enter my email and click "Join the Waitlist"
6. Check Supabase → pro_waitlist table — should see my email
