-- RLS repair for historical replay tables that were created before policies
-- were checked into the app schema.

alter table public.serper_query_cache enable row level security;

drop policy if exists "Service role manages Serper cache"
  on public.serper_query_cache;
create policy "Service role manages Serper cache"
  on public.serper_query_cache
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

alter table public.book_discussion_links enable row level security;

drop policy if exists "Discussion links are public"
  on public.book_discussion_links;
create policy "Discussion links are public"
  on public.book_discussion_links
  for select
  using (true);

drop policy if exists "Service role manages discussion links"
  on public.book_discussion_links;
create policy "Service role manages discussion links"
  on public.book_discussion_links
  for insert
  with check ((select auth.role()) = 'service_role');

drop policy if exists "Service role updates discussion links"
  on public.book_discussion_links;
create policy "Service role updates discussion links"
  on public.book_discussion_links
  for update
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

drop policy if exists "Service role deletes discussion links"
  on public.book_discussion_links;
create policy "Service role deletes discussion links"
  on public.book_discussion_links
  for delete
  using ((select auth.role()) = 'service_role');
