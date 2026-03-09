# Prompt 05 — Ratings Scraper (Goodreads, Amazon, romance.io)

> ⚠️ Important note: This scraping is for personal/research use. We scrape respectfully:
> - We cache results for 24 hours minimum (so we never hit the same page twice in a day)
> - We add delays between requests
> - We identify ourselves with a user agent
> This is standard practice for aggregator apps.

---

Build the scraping layer that enriches books with ratings and spice data from external sites.

## Architecture principle
Scraping is SLOW and can fail. So:
1. Always check the Supabase cache first
2. Only scrape if data is stale (>24 hours old) or missing
3. Run scrapers in the background — never block the user waiting for scraping
4. If scraping fails, return what we have and log the error silently

## 1. Goodreads scraper

Create `/lib/scraping/goodreads.ts`:

```
Function: scrapeGoodreadsRating(bookTitle: string, author: string): Promise<GoodreadsData | null>

Strategy:
- Construct search URL: https://www.goodreads.com/search?q={title}+{author}
- Use node-fetch with a realistic User-Agent header
- Use cheerio to parse the HTML
- Find the first search result's rating (CSS selector for the rating number)
- Find the ratings count
- Return: { rating: number, ratingCount: number, goodreadsId: string } or null

Error handling:
- If fetch fails (rate limited, blocked), return null and log warning
- If rating element not found, return null
- Never throw — always return null on failure

Add a 1-2 second delay before fetching (respectful scraping).
```

## 2. Amazon scraper  

Create `/lib/scraping/amazon.ts`:

```
Function: scrapeAmazonRating(isbn: string, asin?: string): Promise<AmazonData | null>

Strategy:
- If we have an ASIN: https://www.amazon.com/dp/{asin}
- If we only have ISBN: https://www.amazon.com/s?k={isbn}
- Parse the rating number and rating count from the product page
- Also extract the ASIN from the URL if we don't have it yet
- Return: { rating: number, ratingCount: number, asin: string, kindleAsin?: string } or null

Note: Amazon is the hardest to scrape reliably. Return null gracefully if it fails.
```

## 3. romance.io scraper

Create `/lib/scraping/romance-io.ts`:

```
Function: scrapeRomanceIo(bookTitle: string, author: string): Promise<RomanceIoData | null>

Strategy:
- Search URL: https://www.romance.io/books?search={title}
- Parse the first matching result
- Extract: overall rating, spice level (their 1-5 heat rating), trope tags
- Return: { rating: number, spiceLevel: number, tropes: string[], slug: string } or null

The spice level and tropes from romance.io are the most valuable data we get from scraping.
```

## 4. Scraping orchestrator

Create `/lib/scraping/index.ts`:

```
Function: enrichBookWithExternalData(bookId: string, title: string, author: string, isbn?: string)
- Check when each source was last scraped (from book_ratings / book_spice tables)
- For sources that are stale or missing:
  - Run the appropriate scraper
  - Save results to Supabase (book_ratings, book_spice, book_tropes)
- Return { goodreads, amazon, romanceIo } with whatever we got

Function: scheduleEnrichment(bookId: string, title: string, author: string)
- This is the fire-and-forget version
- Call enrichBookWithExternalData but don't await it
- Log start and completion
- Use this when we don't want to block the user
```

## 5. Background enrichment API route

Create `/app/api/books/enrich/route.ts`:
- POST endpoint
- Accepts: `{ bookId, title, author, isbn }`
- Calls `scheduleEnrichment` 
- Returns immediately with `{ status: "enrichment_started" }`
- The actual scraping happens asynchronously

## 6. Wire it into the book detail flow

Update `/lib/books/index.ts` → `getBookDetail()`:
- After returning cached data, check if enrichment is needed
- If ratings are missing or >24h old, call the enrichment API route in the background
- The user sees cached data instantly; fresh data appears on next page load

## 7. Test

Tell me to visit: `http://localhost:3000/api/books/search?q=the+kiss+quotient`

After the first load (which triggers enrichment), wait 10 seconds and reload. I should see ratings from external sources appearing.
