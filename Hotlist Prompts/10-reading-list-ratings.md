# Prompt 10 — Reading List & User Ratings

> Users can track what they've read, what they're reading, and what's next.
> They can also leave their own star + spice ratings.

---

Build the reading status tracking and user ratings features.

## 1. Reading status functions

Create `/lib/reading-status.ts`:

```
Function: getReadingStatus(userId: string, bookId: string): Promise<ReadingStatus | null>

Function: setReadingStatus(userId: string, bookId: string, status: 'want_to_read' | 'reading' | 'read'): Promise<void>
- Upsert into reading_status table
- If setting to 'read': prompt user to rate (handled in UI, not here)

Function: getUserShelf(userId: string, status: 'want_to_read' | 'reading' | 'read'): Promise<Book[]>
- Returns all books with this status for the user
- Include basic book data + user's rating if available

Function: removeReadingStatus(userId: string, bookId: string): Promise<void>
```

## 2. Reading status component

Create `/components/books/ReadingStatusButtons.tsx`:
- Three pill buttons: "Want to Read" | "Reading" | "Read"
- Active state: fire color background, white text
- Inactive state: cream background, muted text, thin border
- Clicking sets the status via API and updates UI immediately (optimistic update)
- If no status set: all three buttons shown in inactive state
- Small checkmark icon on "Read" button when active
- Requires auth — if not logged in, clicking triggers sign-in modal

## 3. User rating functions  

Create `/lib/ratings.ts`:

```
Function: getUserRating(userId: string, bookId: string): Promise<UserRating | null>

Function: saveUserRating(userId: string, bookId: string, rating: {
  starRating?: number,
  spiceRating?: number, 
  note?: string
}): Promise<UserRating>
- Upsert into user_ratings table
- After saving spice rating: recalculate community spice average for this book
  and update book_spice table where source = 'hotlist_community'

Function: getCommunitySpiceAverage(bookId: string): Promise<{ average: number, count: number } | null>
- Calculate average of all user spice ratings for this book
- Only return if count >= 5 (minimum for reliable average)
```

## 4. Rating widget component

Create `/components/books/RatingWidget.tsx`:

Used on the book detail page after a user marks a book as Read.

Layout:
```
Your Rating
[★][★][★][★][★]    (interactive, click to set 1-5)

Your Spice Take  
[🌶️][🌶️][🌶️][🌶️][🌶️]  (interactive, click to set 1-5)

Private Note (optional)
[textarea: "Your reading notes — only you can see this"]

[Save Rating]  [Clear Rating]
```

Behavior:
- Stars: hover shows preview, click sets rating
- Chilis: same as stars
- Note: plain textarea, no character limit
- Save button: calls `saveUserRating`, shows success toast "Rating saved ✓"
- Pre-fills if user already has a rating
- Shows after user sets status to "Read" OR is accessible from profile page

## 5. My Reading List page

Create `/app/reading-list/page.tsx` (requires auth):

Three tabs: **Want to Read** | **Reading** | **Read**

Each tab shows a list of books:
- Cover, title, author, ratings summary, spice, tropes
- Status badge
- For "Read" tab: shows user's own star rating if set, or "Rate this book →"
- Remove from shelf button (⋯ menu → Remove)

**Summary stats at top:**
- "You've read X books · X on your list · X currently reading"

**For the "Read" tab:**
- Inline rating display
- Quick "Rate" button if not yet rated — opens RatingWidget inline

## 6. Rating prompt after finishing a book

When a user changes status to "Read":
- Show a small toast/popup: "Finished [Book Title]! ⭐ How was it?"
- Two buttons: "Rate Now" (opens rating widget) and "Maybe Later"
- This is the moment when we collect the most ratings — don't miss it

## 7. Community spice on book detail

Update the book detail page (from Prompt 07):
- If community spice average exists (≥5 ratings): show it alongside romance.io spice
- Display: 
  - "romance.io: 🌶️🌶️🌶️" 
  - "Hotlist readers: 🌶️🌶️🌶️🌶️ (23 ratings)"
- If no community data yet: show only romance.io data, no empty row

## Test it

Tell me to:
1. Find a book and mark it as "Want to Read" — button should highlight
2. Change it to "Reading" — should update instantly
3. Change it to "Read" — should prompt to rate
4. Rate it 4 stars, 3 spice peppers, add a note "Test note"
5. Navigate to My Reading List — should see the book in the "Read" tab with my rating
6. Go back to the book detail page — should see my rating in the rating widget
