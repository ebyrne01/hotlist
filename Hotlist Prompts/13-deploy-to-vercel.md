# Prompt 13 — Deploy to Vercel

> This is the final step. We push the code to GitHub and deploy to Vercel.
> After this, Hotlist will be live on the internet.

---

## Step 1 — Prepare for production

Before deploying, make these checks:

1. Make sure `.env.local` is in `.gitignore` (it should be — just verify)
2. Make sure `.env.example` exists and lists all variable names (without values)
3. Run `npm run build` locally and confirm it builds without errors
   - If there are any TypeScript errors, fix them before continuing
   - Common issue: missing `await` on async functions, or `undefined` values not handled

## Step 2 — Push to GitHub

Tell me to do this in my terminal (inside the hotlist project folder):

```bash
git init                          # if not already a git repo
git add .
git commit -m "feat: initial Hotlist app"
git branch -M main
git remote add origin [MY_GITHUB_REPO_URL]   # I'll replace this with my actual repo URL
git push -u origin main
```

Tell me to open GitHub and confirm I can see my code there before continuing.

## Step 3 — Connect to Vercel

Tell me to:
1. Go to vercel.com and sign in
2. Click "Add New Project"
3. Select my GitHub repository (hotlist)
4. Framework: it should auto-detect Next.js
5. **DO NOT click Deploy yet** — we need to add environment variables first

## Step 4 — Add environment variables to Vercel

In the Vercel project setup, under "Environment Variables", I need to add each variable from my `.env.local` file.

List each variable I need to add and where to find its value:

| Variable | Where to find it |
|----------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard → Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Settings → API → service_role key |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `GOOGLE_BOOKS_API_KEY` | console.cloud.google.com → APIs → Books API |
| `AMAZON_AFFILIATE_TAG` | affiliate-program.amazon.com → Account → Store ID |
| `NEXT_PUBLIC_APP_URL` | Set this to your Vercel URL e.g. `https://hotlist.vercel.app` |

## Step 5 — Update Supabase auth redirect URLs

After getting the Vercel URL, I need to update Supabase to allow redirects from it:

Tell me to go to:
- Supabase dashboard → Authentication → URL Configuration
- Add to "Redirect URLs": `https://[MY_VERCEL_URL]/auth/callback`
- Also add: `https://[MY_CUSTOM_DOMAIN]/auth/callback` (if I have one)

## Step 6 — Deploy

Now click Deploy in Vercel. The build will take 2-3 minutes.

Tell me what a successful deployment looks like and what a failed one looks like.

If the build fails:
- Show me how to read the Vercel build logs
- The most common errors and how to fix them:
  - Missing env variables → check Vercel env vars are all set
  - TypeScript errors → fix in code, push again
  - Import errors → check all file paths are correct

## Step 7 — Verify production

After deployment, tell me to test these on the live URL:

- [ ] Homepage loads with fonts and styling
- [ ] Search works (try "The Kiss Quotient")
- [ ] Book detail page loads with ratings
- [ ] Sign in with Google works (not just localhost)
- [ ] Add a book to a Hotlist
- [ ] Make a Hotlist public and copy the share link
- [ ] Open the share link in incognito — should work without logging in
- [ ] Buy button opens Amazon in a new tab with affiliate tag

## Step 8 — Custom domain (optional)

If I have a custom domain (e.g. hotlist.app):
1. In Vercel project → Settings → Domains → Add domain
2. In my domain registrar (GoDaddy, Namecheap, etc.) → add the DNS records Vercel shows
3. Wait 10-30 minutes for DNS to propagate
4. Update `NEXT_PUBLIC_APP_URL` in Vercel env vars to the custom domain
5. Update Supabase redirect URLs to include the custom domain

## Step 9 — Set up automatic deployments

Vercel automatically deploys every time I push to the `main` branch on GitHub. Explain how this works:
- I make changes → push to GitHub → Vercel auto-deploys → live in 2-3 minutes
- Preview deployments: any other branch gets its own preview URL for testing

## 🎉 Hotlist is live!

After completing this, give me a summary of:
- The live URL
- How to make future updates (edit code → git push → auto deploys)
- How to check analytics (Vercel dashboard)
- How to monitor errors (Vercel functions tab)
- How to see my Supabase data (Supabase table editor)
