# Prompt 09 — The Hotlist Feature

> This is the product's namesake and most important feature.
> A Hotlist is a named comparison list of books a user is deciding between.

---

Build the complete Hotlist feature: creating lists, adding books, the comparison table view, and sharing.

## 1. Hotlist data functions

Create `/lib/hotlists.ts`:

```
Function: getUserHotlists(userId: string): Promise<Hotlist[]>
- Fetch all hotlists for this user from Supabase
- Include book count per list
- Order by updated_at desc

Function: getHotlistWithBooks(hotlistId: string, userId?: string): Promise<HotlistDetail | null>
- Fetch the hotlist + all its books with FULL book detail
- Full detail = book record + all ratings (goodreads/amazon/romance_io) + spice + tropes + user's own rating
- If the list is private and userId doesn't match owner: return null
- If the list is public: return regardless of userId

Function: createHotlist(userId: string, name: string): Promise<Hotlist>
- Insert new hotlist into Supabase
- Generate a share_slug: slugify(name) + random 4-char suffix (e.g. "fae-books-xk3p")
- Return created hotlist

Function: addBookToHotlist(hotlistId: string, bookId: string, userId: string): Promise<void>
- Verify the user owns this hotlist
- Insert into hotlist_books
- Update hotlist updated_at

Function: removeBookFromHotlist(hotlistId: string, bookId: string, userId: string): Promise<void>
- Verify ownership
- Delete from hotlist_books

Function: toggleHotlistPublic(hotlistId: string, userId: string): Promise<Hotlist>
- Toggle is_public between true/false
- Return updated hotlist

Function: deleteHotlist(hotlistId: string, userId: string): Promise<void>
- Verify ownership
- Delete hotlist (cascade deletes hotlist_books)
```

## 2. "Add to Hotlist" popover component

Create `/components/hotlists/AddToHotlistPopover.tsx`:

This appears when a logged-in user clicks "Add to Hotlist" on any book card or detail page.

- Anchor to the button that triggered it
- Shows list of user's current hotlists with book counts
- Each list item: list name, book count, checkmark if book is already in it
- Clicking a list: adds/removes the book, shows instant feedback (checkmark animates in)
- "＋ New Hotlist" option at the bottom:
  - Expands inline input field for list name
  - User types name and presses Enter or clicks "Create"
  - New list is created AND book is added to it immediately
- Close on click outside
- Loading state while fetching user's lists

## 3. Hotlist comparison table

Create `/components/hotlists/HotlistTable.tsx` — the signature feature:

A data table where:
- Each **row** is a book
- Each **column** is sortable

**Columns (in order)**:
1. **Book** — cover thumbnail + title + author (not sortable, always first)
2. **Goodreads** ↕ — numeric rating, sortable
3. **Amazon** ↕ — numeric rating, sortable
4. **romance.io** ↕ — numeric rating, sortable
5. **Spice** ↕ — chili pepper icons, sortable by level
6. **My ★** — user's own star rating (editable inline, or "—" if unrated)
7. **Tropes** — top 2-3 trope pills (not sortable)
8. **Pages** ↕ — page count, sortable
9. **Buy** — "Kindle →" and "Print →" buttons (not sortable)
10. **Remove** — ✕ button to remove from list (only visible to owner)

**Sorting**: click any column header with ↕ to sort ascending, click again for descending

**Mobile behavior**: 
- On small screens, columns 3-8 collapse into a horizontal scroll
- Show: Book | Avg Rating | Spice | Buy as the fixed visible columns
- User can scroll horizontally to see all data

**Empty state**: 
- If fewer than 2 books: "Add at least 2 books to compare them"
- Show a search bar inline to find and add books directly from the list view

## 4. Hotlist detail page

Create `/app/lists/[slug]/page.tsx`:

**If owner viewing their own list:**
- Editable list name (click to edit inline)
- Privacy toggle: "🔒 Private" / "🌐 Public & Shareable" with one-click toggle
- Share button (only visible if public): copies link + shows share card
- The HotlistTable component
- "＋ Add another book" search bar below the table
- Delete list button (with confirm dialog)

**If public list viewed by non-owner:**
- Read-only view of the HotlistTable
- Banner at top: "📚 [Username]'s Hotlist — Build your own on Hotlist 🔥" with sign-up CTA
- No edit controls
- No Remove column
- Buy buttons still work (they're affiliate links)

**If private list viewed by non-owner:**
- Friendly "This Hotlist is private" page
- Link back to homepage

## 5. My Hotlists page

Create `/app/lists/page.tsx` (requires auth):

- Header: "My Hotlists"
- Grid of hotlist cards:
  - Card shows: list name, book count, "public/private" badge, "updated X days ago"
  - Clicking opens the list
  - ✕ to delete (with confirmation)
- "＋ Create New Hotlist" button — opens inline modal to name it
- If no hotlists: empty state with "Create your first Hotlist to start comparing books"

## 6. Share link flow

When a user shares their public Hotlist:
- The URL is: `hotlist.app/lists/[share_slug]`
- This page works for logged-out users (read-only)
- The top banner includes: "Build your own Hotlist — it's free →" CTA
- Open Graph metadata: "Check out [username]'s Hotlist: [list name] — [book count] books compared"

## Test it

Tell me to:
1. Sign in to my account
2. Search for a book and click "Add to Hotlist"
3. Create a new list called "Test List"
4. Add 2-3 more books to the list
5. Navigate to My Hotlists
6. Open the list and see the comparison table
7. Click a column header to sort
8. Toggle the list to Public and copy the share link
9. Open the share link in a private/incognito browser window — should see read-only table
