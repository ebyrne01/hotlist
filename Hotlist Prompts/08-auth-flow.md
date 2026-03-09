# Prompt 08 — Authentication Flow

IMPORTANT: Before building, note that localhost:3000, 3001, 3002, 
and 3003 have already been added to Supabase Auth redirect URLs. 
Also add https://myhotlist.app/auth/callback and 
https://www.myhotlist.app/auth/callback to the allowed list if not 
already there. No other corrections needed — build as written.

> Users sign in with Google or Apple. No email/password. 
> Zero friction — the whole flow should take under 10 seconds.

---

Build the complete authentication flow.

## 1. Sign-in modal component

Create `/components/auth/SignInModal.tsx`:
- A modal overlay (not a full page redirect)
- Centered card with:
  - "Hotlist 🔥" wordmark at top
  - Headline: "Save books. Build your Hotlist."
  - Subheading: "Sign in free — no password needed."
  - "Continue with Google" button (with Google logo SVG icon, white background)
  - "Continue with Apple" button (with Apple logo SVG icon, black background)
  - Small muted text: "By signing in you agree to our Terms & Privacy Policy"
- Closes on click outside or ESC key
- Shows a loading spinner while auth is in progress

## 2. Auth context / hook

Create `/lib/auth/useAuth.ts`:
- Custom hook that wraps Supabase auth
- Returns: `{ user, profile, isLoading, signInWithGoogle, signInWithApple, signOut }`
- `signInWithGoogle()` — calls Supabase OAuth with Google provider, redirect back to current page
- `signInWithApple()` — calls Supabase OAuth with Apple provider
- `signOut()` — signs out and redirects to homepage
- Handles auth state changes (listen to `onAuthStateChange`)

Create `/lib/auth/AuthProvider.tsx`:
- React context provider that wraps the app
- Makes `useAuth` available everywhere
- Add to `/app/layout.tsx`

## 3. Sign-in trigger

Create a global sign-in trigger:
- Any component can call `openSignIn()` from a hook
- Example: clicking "Add to Hotlist" when logged out → opens the modal
- After successful sign-in: completes the action the user was trying to do

Create `/lib/auth/useSignInModal.ts`:
- `openSignIn(onSuccess?: () => void)` — opens the modal
- `closeSignIn()` — closes it
- The `onSuccess` callback fires after the user successfully authenticates

## 4. Auth callback page

Create `/app/auth/callback/route.ts`:
- Handles the OAuth redirect from Google/Apple
- Exchanges the code for a session
- Redirects back to the original page (use the `next` query param)
- If no `next` param: redirect to homepage

## 5. Protected actions pattern

For any action that requires login (adding to hotlist, rating, etc.):
```tsx
// Pattern to use everywhere:
const { user } = useAuth()
const { openSignIn } = useSignInModal()

const handleAddToHotlist = () => {
  if (!user) {
    openSignIn(() => handleAddToHotlist()) // retry after sign-in
    return
  }
  // proceed with the action
}
```

Document this pattern clearly in a comment at the top of `/lib/auth/useSignInModal.ts` so it's easy to reuse.

## 6. User profile page

Create `/app/profile/page.tsx` (protected route):
- Shows: avatar, display name, "Member since" date
- Stats: books read, books want to read, hotlists created, ratings given
- Link to "My Hotlists"
- Link to "My Reading List"
- Sign Out button
- Pro Waitlist join button (if not already on it)

## 7. Test the full flow

Tell me to:
1. Click "Sign In" in the navbar
2. The modal should appear
3. Click "Continue with Google"
4. I should be redirected to Google, sign in, and come back to Hotlist
5. The navbar should now show my avatar/initials
6. Clicking my avatar should show the dropdown

If this all works, auth is complete.
