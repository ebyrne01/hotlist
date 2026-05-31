-- Address Supabase advisor findings that are safe to fix without changing
-- public app behavior. Public submissions stay public where needed, but with
-- constrained checks instead of fully open writes.

alter table public.agent_debug_logs enable row level security;
alter table public.quality_flags enable row level security;
alter table public.quality_health_log enable row level security;

drop policy if exists "Service role manages agent debug logs" on public.agent_debug_logs;
create policy "Service role manages agent debug logs"
  on public.agent_debug_logs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role manages quality flags" on public.quality_flags;
create policy "Service role manages quality flags"
  on public.quality_flags
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role manages quality health log" on public.quality_health_log;
create policy "Service role manages quality health log"
  on public.quality_health_log
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role manages cron logs" on public.cron_logs;
create policy "Service role manages cron logs"
  on public.cron_logs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Analytics insertable by anyone" on public.analytics_events;
drop policy if exists "Service role manages analytics events" on public.analytics_events;
create policy "Service role manages analytics events"
  on public.analytics_events
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Creators see own analytics" on public.analytics_events;
create policy "Creators see own analytics"
  on public.analytics_events
  for select
  to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists "Anyone can submit grab feedback" on public.grab_feedback;
create policy "Anyone can submit grab feedback"
  on public.grab_feedback
  for insert
  to anon, authenticated
  with check (
    length(trim(video_url)) > 0
    and feedback_type in ('wrong_book', 'wrong_edition', 'missing_book')
    and (user_id is null or user_id = (select auth.uid()))
    and (book_title is null or length(book_title) <= 500)
    and (notes is null or length(notes) <= 2000)
  );

drop policy if exists "Service role can read grab feedback" on public.grab_feedback;
drop policy if exists "Service role manages grab feedback" on public.grab_feedback;
create policy "Service role manages grab feedback"
  on public.grab_feedback
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "search_analytics_insert" on public.search_analytics;
drop policy if exists "Service role manages search analytics" on public.search_analytics;
create policy "Service role manages search analytics"
  on public.search_analytics
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "search_analytics_select_admin" on public.search_analytics;
create policy "search_analytics_select_admin"
  on public.search_analytics
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.is_admin = true
    )
  );

drop policy if exists "spice_signals_service_insert" on public.spice_signals;
drop policy if exists "spice_signals_service_update" on public.spice_signals;
drop policy if exists "Service role can write spice signals" on public.spice_signals;
create policy "Service role manages spice signals"
  on public.spice_signals
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Users see own signals" on public.reading_dna_signals;
drop policy if exists "Users manage own signals" on public.reading_dna_signals;
drop policy if exists "Service role can manage signals" on public.reading_dna_signals;
create policy "Users manage own signals"
  on public.reading_dna_signals
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own CW prefs" on public.user_cw_preferences;
drop policy if exists "Service role full access on CW prefs" on public.user_cw_preferences;
create policy "Users manage own CW prefs"
  on public.user_cw_preferences
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace view public.composite_spice
with (security_invoker = true)
as
select
  book_id,
  round(
    sum(
      spice_value * confidence *
      case source
        when 'community' then 1.0
        when 'romance_io' then 0.85
        when 'review_classifier' then 0.6
        when 'llm_inference' then 0.4
        when 'genre_bucketing' then 0.2
        else null
      end
    ) / nullif(
      sum(
        confidence *
        case source
          when 'community' then 1.0
          when 'romance_io' then 0.85
          when 'review_classifier' then 0.6
          when 'llm_inference' then 0.4
          when 'genre_bucketing' then 0.2
          else null
        end
      ),
      0
    ),
    1
  ) as composite_score,
  (
    array_agg(
      source
      order by
        confidence *
        case source
          when 'community' then 1.0
          when 'romance_io' then 0.85
          when 'review_classifier' then 0.6
          when 'llm_inference' then 0.4
          when 'genre_bucketing' then 0.2
          else null
        end desc
    )
  )[1] as primary_source,
  max(
    case
      when source = 'community' then (evidence ->> 'rating_count')::integer
      else null
    end
  ) as community_count,
  count(*) as signal_count,
  max(
    confidence *
    case source
      when 'community' then 1.0
      when 'romance_io' then 0.85
      when 'review_classifier' then 0.6
      when 'llm_inference' then 0.4
      when 'genre_bucketing' then 0.2
      else null
    end
  ) as overall_confidence
from public.spice_signals
group by book_id;

do $$
begin
  if to_regprocedure('public.refresh_community_spice()') is not null then
    execute 'alter function public.refresh_community_spice() set search_path = public';
    execute 'revoke all on function public.refresh_community_spice() from public, anon, authenticated';
  end if;
  if to_regprocedure('public.increment_enrichment_attempts(uuid)') is not null then
    execute 'alter function public.increment_enrichment_attempts(uuid) set search_path = public';
  end if;
  if to_regprocedure('public.touch_quality_flag()') is not null then
    execute 'alter function public.touch_quality_flag() set search_path = public';
  end if;
  if to_regprocedure('public.count_distinct_creator_books(uuid)') is not null then
    execute 'alter function public.count_distinct_creator_books(uuid) set search_path = public';
  end if;
  if to_regprocedure('public.count_followers_batch(uuid[])') is not null then
    execute 'alter function public.count_followers_batch(uuid[]) set search_path = public';
  end if;
  if to_regprocedure('public.find_duplicate_books()') is not null then
    execute 'alter function public.find_duplicate_books() set search_path = public';
  end if;
  if to_regprocedure('public.fuzzy_book_search(text, integer)') is not null then
    execute 'alter function public.fuzzy_book_search(text, integer) set search_path = public';
  end if;
  if to_regprocedure('public.search_books_fuzzy(text, integer)') is not null then
    execute 'alter function public.search_books_fuzzy(text, integer) set search_path = public';
  end if;
  if to_regprocedure('public.search_books_fuzzy(text, text, integer)') is not null then
    execute 'alter function public.search_books_fuzzy(text, text, integer) set search_path = public';
  end if;
  if to_regprocedure('public.search_books_fuzzy(text, double precision, integer)') is not null then
    execute 'alter function public.search_books_fuzzy(text, double precision, integer) set search_path = public';
  end if;
  if to_regprocedure('public.refresh_creator_handle_stats()') is not null then
    execute 'alter function public.refresh_creator_handle_stats() set search_path = public';
  end if;
  if to_regprocedure('public.increment_grab_count(uuid)') is not null then
    execute 'alter function public.increment_grab_count(uuid) set search_path = public';
  end if;
  if to_regprocedure('public.merge_book_references(uuid, uuid)') is not null then
    execute 'alter function public.merge_book_references(uuid, uuid) set search_path = public';
  end if;
  if to_regprocedure('public.count_canon_with_source(text)') is not null then
    execute 'alter function public.count_canon_with_source(text) set search_path = public';
  end if;
  if to_regprocedure('public.count_canon_with_spice_source(text)') is not null then
    execute 'alter function public.count_canon_with_spice_source(text) set search_path = public';
  end if;
  if to_regprocedure('public.count_canon_with_tropes()') is not null then
    execute 'alter function public.count_canon_with_tropes() set search_path = public';
  end if;
  if to_regprocedure('public.count_canon_with_recommendations()') is not null then
    execute 'alter function public.count_canon_with_recommendations() set search_path = public';
  end if;
  if to_regprocedure('public.find_series_orphans()') is not null then
    execute 'alter function public.find_series_orphans() set search_path = public';
  end if;
end;
$$;

create index if not exists analytics_events_book_idx
  on public.analytics_events (book_id, created_at desc);
create index if not exists book_tropes_trope_idx
  on public.book_tropes (trope_id);
create index if not exists creator_applications_claim_handle_idx
  on public.creator_applications (claim_handle_id);
create index if not exists creator_book_mentions_video_grab_idx
  on public.creator_book_mentions (video_grab_id);
create index if not exists dnf_reasons_book_idx
  on public.dnf_reasons (book_id);
create index if not exists grab_feedback_book_idx
  on public.grab_feedback (book_id);
create index if not exists grab_feedback_user_idx
  on public.grab_feedback (user_id);
create index if not exists harvest_log_user_idx
  on public.harvest_log (user_id);
create index if not exists hotlist_books_book_idx
  on public.hotlist_books (book_id);
create index if not exists hotlists_user_idx
  on public.hotlists (user_id);
create index if not exists pro_waitlist_user_idx
  on public.pro_waitlist (user_id);
create index if not exists reading_dna_signals_book_idx
  on public.reading_dna_signals (book_id);
create index if not exists reading_status_book_idx
  on public.reading_status (book_id);
create index if not exists user_ratings_book_idx
  on public.user_ratings (book_id);
create index if not exists video_grabs_user_idx
  on public.video_grabs (user_id);

drop index if exists public.idx_books_enrichment_status;
drop index if exists public.idx_spice_signals_book;
