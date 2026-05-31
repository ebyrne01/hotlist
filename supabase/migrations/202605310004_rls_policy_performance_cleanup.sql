-- Follow-up advisor cleanup: keep access semantics the same, but avoid
-- per-row auth.role()/auth.uid() calls and duplicate owner policies.

create index if not exists discovery_candidates_resolved_book_idx
  on public.discovery_candidates (resolved_book_id);

drop policy if exists "Service role manages API rate limits" on public.api_rate_limits;
create policy "Service role manages API rate limits"
  on public.api_rate_limits
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role write" on public.book_buzz_signals;
drop policy if exists "Service role manages book buzz signals" on public.book_buzz_signals;
create policy "Service role manages book buzz signals"
  on public.book_buzz_signals
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role can write ratings" on public.book_ratings;
create policy "Service role can write ratings"
  on public.book_ratings
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role can write spice" on public.book_spice;
create policy "Service role can write spice"
  on public.book_spice
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role can write trope vectors" on public.book_trope_vectors;
create policy "Service role can write trope vectors"
  on public.book_trope_vectors
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role can write book tropes" on public.book_tropes;
create policy "Service role can write book tropes"
  on public.book_tropes
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role can write books" on public.books;
create policy "Service role can write books"
  on public.books
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role manages discovery candidates" on public.discovery_candidates;
create policy "Service role manages discovery candidates"
  on public.discovery_candidates
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role manages enrichment queue" on public.enrichment_queue;
create policy "Service role manages enrichment queue"
  on public.enrichment_queue
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role writes harvest log" on public.harvest_log;
drop policy if exists "Service role manages harvest log" on public.harvest_log;
create policy "Service role manages harvest log"
  on public.harvest_log
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role can write homepage cache" on public.homepage_cache;
create policy "Service role can write homepage cache"
  on public.homepage_cache
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role manages nyt trending" on public.nyt_trending;
create policy "Service role manages nyt trending"
  on public.nyt_trending
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role manages Serper cache" on public.serper_query_cache;
create policy "Service role manages Serper cache"
  on public.serper_query_cache
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role can write tropes" on public.tropes;
create policy "Service role can write tropes"
  on public.tropes
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Users can apply" on public.creator_applications;
drop policy if exists "Users create own creator applications" on public.creator_applications;
create policy "Users create own creator applications"
  on public.creator_applications
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users see own application" on public.creator_applications;
drop policy if exists "Users see own creator applications" on public.creator_applications;
create policy "Users see own creator applications"
  on public.creator_applications
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users delete own rejected creator applications" on public.creator_applications;
create policy "Users delete own rejected creator applications"
  on public.creator_applications
  for delete
  to authenticated
  using ((select auth.uid()) = user_id and status = 'rejected');

drop policy if exists "Creators manage own share cards" on public.creator_share_cards;
create policy "Creators manage own share cards"
  on public.creator_share_cards
  for all
  to authenticated
  using ((select auth.uid()) = creator_id)
  with check ((select auth.uid()) = creator_id);

drop policy if exists "Users manage own DNF reasons" on public.dnf_reasons;
create policy "Users manage own DNF reasons"
  on public.dnf_reasons
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Service role can manage DNA" on public.reading_dna;
drop policy if exists "Users see own DNA" on public.reading_dna;
drop policy if exists "Users manage own DNA" on public.reading_dna;
create policy "Users manage own DNA"
  on public.reading_dna
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users see own follows" on public.user_follows;
drop policy if exists "Users manage own follows" on public.user_follows;
drop policy if exists "Users unfollow" on public.user_follows;
create policy "Users manage own follows"
  on public.user_follows
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
