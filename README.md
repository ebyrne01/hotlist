# Hotlist

Hotlist is a romance and romantasy book intelligence app. Readers can search
for books, compare Goodreads/Amazon/Romance.io ratings, inspect spice and trope
signals, and save titles into side-by-side Hotlists.

## Stack

- Next.js 14 App Router
- Tailwind CSS
- Supabase Postgres/Auth
- Vercel
- Anthropic/OpenAI-backed enrichment workflows

## Local Development

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Useful Checks

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
npm run db:check-schema:warn
```

`npm run db:check-schema:warn` reports Supabase tables and RPCs referenced by
code that are not yet represented in checked-in SQL. New database changes should
be added under `supabase/migrations/`.
