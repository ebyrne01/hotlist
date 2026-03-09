# Prompt 02 — Supabase Database Setup

> **Before you run this**: 
> 1. Go to supabase.com and open your project
> 2. Click "Settings" → "API" and copy your Project URL and anon public key
> 3. Also copy the service_role key (keep this secret!)
> 4. Paste these into your `.env.local` file
> 5. Then paste this prompt into Claude Code

---

My Supabase project is connected. Now let's set up the database.

## Step 1 — Run the schema

I have a file called `schema.sql` in my project root. Please:

1. Read the contents of `schema.sql`
2. Tell me to go to my Supabase dashboard → SQL Editor → New Query
3. Tell me to paste the entire contents and click "Run"
4. Tell me what each section of the schema does in plain English so I understand what tables we're creating

## Step 2 — Set up Supabase Auth

In my Supabase dashboard, I need to enable Google and Apple sign-in. Please give me step-by-step instructions for:

**Google Auth:**
- Where to find the OAuth settings in Supabase
- What I need to create in Google Cloud Console (OAuth 2.0 credentials)
- What redirect URL to use
- Where to paste the Client ID and Secret in Supabase

**Apple Auth:**
- Where to find the Apple sign-in settings in Supabase
- What I need in my Apple Developer account
- Step-by-step setup instructions

## Step 3 — Create the auth helper files

Please create these files in my Next.js project:

1. `/lib/supabase/client.ts` — browser-side Supabase client using `createBrowserClient`
2. `/lib/supabase/server.ts` — server-side client using `createServerClient` with cookie handling
3. `/lib/supabase/middleware.ts` — middleware to refresh auth tokens

4. Create `/middleware.ts` in the project root that:
   - Uses the Supabase middleware to keep sessions fresh
   - Protects routes that start with `/dashboard` or `/lists` (requires login)
   - Lets all other routes through publicly

## Step 4 — Test the connection

Create a simple API route at `/app/api/health/route.ts` that:
- Connects to Supabase
- Queries the `tropes` table and returns the count
- Returns a JSON response like `{ status: "ok", tropes: 25 }`

Tell me to visit `http://localhost:3000/api/health` to verify the database connection works. If I see 25 tropes, we're good.
