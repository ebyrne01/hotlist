# Prompt 01 — Project Setup & Scaffolding

> **Before you run this**: Make sure Claude Code is open in an empty folder on your computer.
> Copy and paste this entire prompt into Claude Code.
>
> **Model to use in Claude Code:** Opus 4.6 (`claude-opus-4-6`) — use this for all build prompts.
> The app's *internal* AI calls use Haiku (hardcoded in the source), but you're building with Opus.

---

Please create a new Next.js 14 project called `hotlist` with the following setup. I am a non-technical user, so please do everything for me and explain what each step does in plain English.

## What to create

1. Initialize a Next.js 14 project using the App Router (not Pages Router). Use TypeScript. Use Tailwind CSS. Say yes to all defaults.

2. Install these additional packages:
   - `@supabase/supabase-js` — connects to our database
   - `@supabase/ssr` — handles auth in Next.js
   - `swr` — smart data fetching
   - `zod` — validates data inputs
   - `cheerio` — for reading web page data
   - `node-fetch` — for making web requests
   - `@anthropic-ai/sdk` — for AI features
   - `lucide-react` — icons
   - `clsx` — utility for CSS classes

3. Create a `.env.local` file with these empty variables (I'll fill them in):
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
GOOGLE_BOOKS_API_KEY=
AMAZON_AFFILIATE_TAG=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

4. Create a `.env.example` file with the same variables (this is safe to commit to GitHub).

5. Update `.gitignore` to include `.env.local`.

6. Set up this folder structure (create each folder and an empty `.gitkeep` file inside):
```
/app
/app/api
/app/(public)        ← pages anyone can see
/app/(auth)          ← pages that need login
/components
/components/ui
/lib
/lib/scraping
```

7. Create `/lib/supabase.ts` with a Supabase client setup that works for both server and client components. Use the `@supabase/ssr` pattern.

8. Create `/lib/supabase-server.ts` with a server-only Supabase client using the service role key (for admin operations like scraping and writing book data).

9. Update `tailwind.config.ts` to add our brand colors and fonts:
   - Primary (fire): `#d4430e`
   - Background (cream): `#faf7f2`  
   - Ink: `#12080a`
   - Muted: `#7a6055`
   - Gold: `#b07d2a`
   - Border: `#e0d2c8`
   - Add Google Fonts: Playfair Display, Libre Baskerville, DM Mono

10. Update the global CSS (`/app/globals.css`) to:
    - Import the Google Fonts
    - Set the body font to Libre Baskerville
    - Set the background to cream (`#faf7f2`)
    - Set the default text color to ink (`#12080a`)

11. Create a simple `/app/page.tsx` that just says "Hotlist 🔥 — Coming Soon" so we can verify the setup works.

12. Run the development server and tell me if everything is working. Then tell me the exact commands to:
    - Start the dev server: `npm run dev`
    - How to open it in my browser

After completing this, give me a checklist of what was created so I can verify everything looks right.
