# Prompt 14 — iOS App Preparation (Future Phase)

> You don't need to build this now. This prompt is ready for when you're 
> ready to bring Hotlist to the Apple App Store.
> The good news: because we built on Supabase, the entire backend is already ready.

---

## Why this is easy

Our Supabase backend is already the iOS app's backend. The database, auth (including Apple Sign-In), and all the data are already there. The iOS app just needs a frontend — no new server needed.

## Recommended approach: Expo (React Native)

**Expo** lets you build iOS apps using a very similar syntax to the Next.js web app we already built. You'll reuse a lot of your logic.

When you're ready, here's the prompt to give Claude Code:

---

## The actual prompt (use this when you're ready for iOS)

I want to build an iOS version of Hotlist that connects to the same Supabase backend as the web app. 

Please:

1. Create a new Expo project called `hotlist-mobile` in a separate folder from the web app
   ```bash
   npx create-expo-app@latest hotlist-mobile --template blank-typescript
   ```

2. Install these packages:
   ```bash
   npx expo install @supabase/supabase-js @react-native-async-storage/async-storage expo-secure-store expo-web-browser expo-auth-session expo-router
   ```

3. Set up the Supabase client for React Native — use `AsyncStorage` instead of cookies (different from web)

4. Configure Apple Sign-In using `expo-auth-session` — we already have the Apple OAuth set up in Supabase, we just need to connect to it from the mobile side

5. Copy these shared logic files from the web app (they work in React Native too):
   - `/lib/types.ts` — all our TypeScript types
   - `/lib/books/index.ts` — book data functions (use Supabase client directly, skip API routes)
   - `/lib/hotlists.ts` — hotlist functions
   - `/lib/ratings.ts` — rating functions

6. Build these screens using Expo Router (similar to Next.js App Router):
   - `/app/index.tsx` — Home (search + What's Hot + trope grid)
   - `/app/book/[slug].tsx` — Book detail
   - `/app/tropes/[slug].tsx` — Trope browse
   - `/app/lists/index.tsx` — My Hotlists
   - `/app/lists/[slug].tsx` — Hotlist comparison view
   - `/app/reading-list.tsx` — Reading list

7. Reuse the same Tailwind-style design system using `nativewind` (Tailwind for React Native)

8. The Hotlist comparison table on mobile should be a horizontal-scrolling ScrollView — React Native doesn't have HTML tables

9. Configure for App Store submission:
   - Bundle ID: `com.hotlist.app`
   - App icons and splash screen
   - Privacy manifest (required by Apple)
   - Run `eas build --platform ios` to create the build

---

## What you'll need before starting iOS

- An Apple Developer account ($99/year) — apple.com/developer
- Expo account (free) — expo.dev
- EAS CLI: `npm install -g eas-cli`

## Timeline estimate

If the web app is fully working: building the iOS app to feature parity is roughly 4-6 weeks of Claude Code sessions, following a similar prompt-by-prompt approach as the web app build.

## Key difference: No scraping on mobile

The iOS app doesn't run scrapers — it reads enriched book data from Supabase (which the web app populated). The web app's enrichment jobs keep the database fresh. This is the right architecture — centralized data fetching, shared by both clients.
