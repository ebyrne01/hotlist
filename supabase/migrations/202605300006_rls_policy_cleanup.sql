-- Service-role clients bypass RLS, so service-only policies add work without
-- adding protection. Remove them and make user auth checks init-plan friendly.

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and policyname ilike 'Service role%'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end;
$$;

revoke all on function public.handle_new_user()
  from public, anon, authenticated;

drop policy if exists "Admins can insert quality flags" on public.quality_flags;
create policy "Admins can insert quality flags"
  on public.quality_flags
  for insert
  with check (
    (select auth.role()) = 'service_role'
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.is_admin = true
    )
  );

drop policy if exists "Users see own creator applications" on public.creator_applications;
create policy "Users see own creator applications"
  on public.creator_applications
  for select
  using ((select auth.uid()) = user_id);

drop policy if exists "Users create own creator applications" on public.creator_applications;
create policy "Users create own creator applications"
  on public.creator_applications
  for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own rejected creator applications" on public.creator_applications;
create policy "Users delete own rejected creator applications"
  on public.creator_applications
  for delete
  using ((select auth.uid()) = user_id and status = 'rejected');

drop policy if exists "Users see own follows" on public.user_follows;
drop policy if exists "Users manage own follows" on public.user_follows;
create policy "Users manage own follows"
  on public.user_follows
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Creators manage own share cards" on public.creator_share_cards;
create policy "Creators manage own share cards"
  on public.creator_share_cards
  for all
  using ((select auth.uid()) = creator_id)
  with check ((select auth.uid()) = creator_id);

drop policy if exists "Users manage own DNF reasons" on public.dnf_reasons;
create policy "Users manage own DNF reasons"
  on public.dnf_reasons
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Rewrite legacy policies too: the old schema snapshot predated the
-- init-plan recommendation and production still carries these policies.
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update
  using ((select auth.uid()) = id);
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles for insert
  with check ((select auth.uid()) = id);
drop policy if exists "Users can delete own profile" on public.profiles;
create policy "Users can delete own profile" on public.profiles for delete
  using ((select auth.uid()) = id);

drop policy if exists "Users see own reading status" on public.reading_status;
drop policy if exists "Users manage own reading status" on public.reading_status;
create policy "Users manage own reading status" on public.reading_status for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users see own ratings" on public.user_ratings;
drop policy if exists "Users manage own ratings" on public.user_ratings;
create policy "Users manage own ratings" on public.user_ratings for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Owner sees all their hotlists" on public.hotlists;
drop policy if exists "Owner manages hotlists" on public.hotlists;
create policy "Owner manages hotlists" on public.hotlists for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Hotlist books follow hotlist visibility" on public.hotlist_books;
create policy "Hotlist books follow hotlist visibility" on public.hotlist_books for select
  using (
    exists (
      select 1
      from public.hotlists h
      where h.id = hotlist_id
        and (h.user_id = (select auth.uid()) or h.is_public = true)
    )
  );
drop policy if exists "Owner manages hotlist books" on public.hotlist_books;
create policy "Owner manages hotlist books" on public.hotlist_books for all
  using (
    exists (
      select 1
      from public.hotlists h
      where h.id = hotlist_id
        and h.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users see own waitlist entry" on public.pro_waitlist;
create policy "Users see own waitlist entry" on public.pro_waitlist for select
  using ((select auth.uid()) = user_id);
drop policy if exists "Authenticated users can join waitlist" on public.pro_waitlist;
create policy "Authenticated users can join waitlist" on public.pro_waitlist for insert
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users update own waitlist entry" on public.pro_waitlist;
create policy "Users update own waitlist entry" on public.pro_waitlist for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete own waitlist entry" on public.pro_waitlist;
create policy "Users delete own waitlist entry" on public.pro_waitlist for delete
  using ((select auth.uid()) = user_id);

drop policy if exists "Authenticated users can create grabs" on public.video_grabs;
create policy "Authenticated users can create grabs" on public.video_grabs for insert
  with check ((select auth.uid()) = user_id);
