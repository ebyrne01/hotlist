# Prompt 04 — Book Data Layer

> This is the engine of Hotlist. We fetch book data from free public APIs, 
> cache it in our Supabase database, and enrich it with AI-generated synopses.
> No coding experience needed — just paste this prompt and let Claude Code do the work.

---

Build the book data layer. This is the code that fetches, stores, and enriches book information.

## 1. Google Books API integration

Create `/lib/books/google-books.ts`:

```
Function: searchGoogleBooks(query: string)
- Fetch from: https://www.googleapis.com/books/v1/volumes?q={query}&maxResults=10
- Use GOOGLE_BOOKS_API_KEY from env if available (works without it at lower rate limits)
- Map the response to our internal Book shape:
  {
    title, author, isbn, isbn13, googleBooksId,
    coverUrl, pageCount, publishedYear, publisher, description
  }
- Handle missing fields gracefully (many books won't have all fields)
- Return array of mapped books

Function: getGoogleBookById(id: string)  
- Fetch single book by Google Books volume ID
- Return mapped book or null
```

## 2. Open Library API integration

Create `/lib/books/open-library.ts`:

```
Function: searchOpenLibrary(query: string)
- Fetch from: https://openlibrary.org/search.json?q={query}&limit=10
- Map to our Book shape
- Use as fallback when Google Books doesn't have a title

Function: getOpenLibraryByISBN(isbn: string)
- Fetch: https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data
- Return mapped book data
```

## 3. Book cache layer (Supabase)

Create `/lib/books/cache.ts`:

```
Function: getBookFromCache(identifier: string)
- identifier can be: title+author string, ISBN, Google Books ID
- Look up in Supabase `books` table
- If found AND data_refreshed_at is less than 24 hours ago, return cached data
- If stale or not found, return null (caller will re-fetch)

Function: saveBookToCache(book: BookData)
- Upsert into `books` table using isbn or googleBooksId as conflict key
- Set data_refreshed_at to now()
- Also upsert ratings into book_ratings table
- Also upsert spice into book_spice table
- Also upsert tropes into book_tropes (looking up trope IDs by slug)

Function: searchBooksInCache(query: string)
- Use Supabase full-text search on the books table
- Return matching books with their ratings and tropes
```

## 4. AI synopsis generation

Create `/lib/books/ai-synopsis.ts`:

```
Function: generateSynopsis(book: { title, author, description, tropes[] })
- Only call this if book.description exists but book.ai_synopsis is null
- Call the Anthropic API using claude-haiku-4-5-20251001 (IMPORTANT: use this exact model, it's cheapest)
- System prompt: "You write warm, engaging book synopses for romance readers. You are spoiler-free, tonal, and use the voice of an enthusiastic reader — not a librarian. Keep it to 3-4 sentences."
- User prompt: include title, author, description, and tropes
- Save the result back to the books table
- Return the synopsis string
- Cache the result — never call AI twice for the same book
```

## 5. Main book service

Create `/lib/books/index.ts` — the single import point for all book operations:

```
Function: findBook(query: string): Promise<Book[]>
- Check cache first
- If cache miss: search Google Books, then Open Library
- Save results to cache
- Return results

Function: getBookDetail(identifier: string): Promise<BookDetail | null>
- Get full book data including ratings, spice, tropes
- Generate AI synopsis if missing
- Return complete book object

Function: getBooksByTrope(tropeSlug: string, options?: { minRating?, maxSpice?, minSpice? })
- Query Supabase for books tagged with this trope
- Support sorting by: rating_avg, spice_level, created_at
- Return paginated results
```

## 6. Types file

Create `/lib/types.ts` with TypeScript types for:
- `Book` — basic book record
- `BookDetail` — book + ratings + spice + tropes
- `Rating` — { source, rating, ratingCount }
- `Trope` — { id, slug, name }
- `Hotlist` — { id, name, isPublic, shareSlug, books[] }
- `HotlistBook` — book within a hotlist
- `UserRating` — { starRating, spiceRating, note }
- `ReadingStatus` — 'want_to_read' | 'reading' | 'read'

## 7. Test it

Create a test API route at `/app/api/books/search/route.ts`:
- Accept a `q` query parameter
- Call `findBook(q)`
- Return JSON results

Tell me to visit: `http://localhost:3000/api/books/search?q=a+court+of+thorns+and+roses`

I should see JSON data with book information. If I do, the data layer works.
