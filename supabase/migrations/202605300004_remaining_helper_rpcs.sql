-- Remaining helper RPCs referenced by app cron jobs, enrichment, and
-- maintenance scripts. These keep operational logic close to Supabase so the
-- web and future mobile clients can share the same data layer.

create extension if not exists pg_trgm;

alter table public.books
  add column if not exists author_crawled_at timestamptz,
  add column if not exists discovery_source text;

create index if not exists books_author_crawl_idx
  on public.books (author, author_crawled_at)
  where goodreads_id is not null;

create index if not exists books_discovery_source_created_idx
  on public.books (discovery_source, created_at desc)
  where discovery_source is not null;

create or replace function public.merge_book_references(
  source_id uuid,
  target_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if source_id is null or target_id is null or source_id = target_id then
    return;
  end if;

  delete from public.hotlist_books s
  where s.book_id = source_id
    and exists (
      select 1 from public.hotlist_books t
      where t.book_id = target_id
        and t.hotlist_id = s.hotlist_id
    );
  update public.hotlist_books set book_id = target_id where book_id = source_id;

  delete from public.user_ratings s
  where s.book_id = source_id
    and exists (
      select 1 from public.user_ratings t
      where t.book_id = target_id
        and t.user_id = s.user_id
    );
  update public.user_ratings set book_id = target_id where book_id = source_id;

  delete from public.reading_status s
  where s.book_id = source_id
    and exists (
      select 1 from public.reading_status t
      where t.book_id = target_id
        and t.user_id = s.user_id
    );
  update public.reading_status set book_id = target_id where book_id = source_id;

  delete from public.book_tropes s
  where s.book_id = source_id
    and exists (
      select 1 from public.book_tropes t
      where t.book_id = target_id
        and t.trope_id = s.trope_id
    );
  update public.book_tropes set book_id = target_id where book_id = source_id;

  delete from public.book_ratings s
  where s.book_id = source_id
    and exists (
      select 1 from public.book_ratings t
      where t.book_id = target_id
        and t.source = s.source
    );
  update public.book_ratings set book_id = target_id where book_id = source_id;

  delete from public.book_spice s
  where s.book_id = source_id
    and exists (
      select 1 from public.book_spice t
      where t.book_id = target_id
        and t.source = s.source
    );
  update public.book_spice set book_id = target_id where book_id = source_id;

  delete from public.spice_signals s
  where s.book_id = source_id
    and exists (
      select 1 from public.spice_signals t
      where t.book_id = target_id
        and t.source = s.source
    );
  update public.spice_signals set book_id = target_id where book_id = source_id;

  delete from public.enrichment_queue s
  where s.book_id = source_id
    and exists (
      select 1 from public.enrichment_queue t
      where t.book_id = target_id
        and t.job_type = s.job_type
    );
  update public.enrichment_queue set book_id = target_id where book_id = source_id;

  delete from public.book_recommendations s
  where s.book_id = source_id
    and exists (
      select 1 from public.book_recommendations t
      where t.book_id = target_id
        and t.recommended_book_id = s.recommended_book_id
    );
  update public.book_recommendations set book_id = target_id where book_id = source_id;

  delete from public.book_recommendations s
  where s.recommended_book_id = source_id
    and exists (
      select 1 from public.book_recommendations t
      where t.book_id = s.book_id
        and t.recommended_book_id = target_id
    );
  update public.book_recommendations
  set recommended_book_id = target_id
  where recommended_book_id = source_id;
  delete from public.book_recommendations where book_id = recommended_book_id;

  delete from public.creator_book_mentions s
  where s.book_id = source_id
    and exists (
      select 1 from public.creator_book_mentions t
      where t.book_id = target_id
        and t.creator_handle_id = s.creator_handle_id
        and t.video_grab_id is not distinct from s.video_grab_id
    );
  update public.creator_book_mentions set book_id = target_id where book_id = source_id;

  delete from public.book_buzz_signals s
  where s.book_id = source_id
    and exists (
      select 1 from public.book_buzz_signals t
      where t.book_id = target_id
        and t.source = s.source
        and t.signal_date = s.signal_date
    );
  update public.book_buzz_signals set book_id = target_id where book_id = source_id;

  delete from public.book_discussion_links s
  where s.book_id = source_id
    and exists (
      select 1 from public.book_discussion_links t
      where t.book_id = target_id
        and t.url = s.url
    );
  update public.book_discussion_links set book_id = target_id where book_id = source_id;
  update public.grab_feedback set book_id = target_id where book_id = source_id;

  delete from public.creator_share_cards s
  where s.book_id = source_id
    and exists (
      select 1 from public.creator_share_cards t
      where t.book_id = target_id
        and t.creator_id = s.creator_id
    );
  update public.creator_share_cards set book_id = target_id where book_id = source_id;

  delete from public.dnf_reasons s
  where s.book_id = source_id
    and exists (
      select 1 from public.dnf_reasons t
      where t.book_id = target_id
        and t.user_id = s.user_id
    );
  update public.dnf_reasons set book_id = target_id where book_id = source_id;

  delete from public.quality_flags s
  where s.book_id = source_id
    and s.status = 'open'
    and exists (
      select 1 from public.quality_flags t
      where t.book_id = target_id
        and t.status = 'open'
        and t.field_name = s.field_name
        and t.issue_type = s.issue_type
    );
  update public.quality_flags set book_id = target_id where book_id = source_id;
end;
$$;

revoke all on function public.merge_book_references(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.merge_book_references(uuid, uuid)
  to service_role;

create or replace function public.get_unscanned_books_for_quality(
  p_limit integer default 40
)
returns table (id uuid, title text)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.title
  from public.books b
  where b.enrichment_status = 'complete'
    and b.is_canon = true
    and not exists (
      select 1
      from public.quality_flags qf
      where qf.book_id = b.id
        and qf.source = 'haiku_scanner'
    )
  order by b.updated_at asc nulls first, b.created_at asc
  limit p_limit;
$$;

create or replace function public.get_uncrawled_popular_authors(
  p_limit integer default 10
)
returns table (author text, goodreads_id text, book_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.author,
    min(b.goodreads_id) as goodreads_id,
    count(distinct hb.book_id)::bigint as book_count
  from public.books b
  left join public.hotlist_books hb on hb.book_id = b.id
  where b.goodreads_id is not null
    and b.author_crawled_at is null
    and b.author is not null
  group by b.author
  order by count(distinct hb.book_id) desc, b.author asc
  limit p_limit;
$$;

create or replace function public.get_recent_discovery_batches(
  lookback_days integer default 7,
  min_batch_size integer default 10
)
returns table (discovery_source text, book_ids uuid[])
language sql
stable
security definer
set search_path = public
as $$
  select
    b.discovery_source,
    array_agg(b.id order by b.created_at desc) as book_ids
  from public.books b
  where b.discovery_source is not null
    and b.created_at >= now() - make_interval(days => lookback_days)
  group by b.discovery_source
  having count(*) >= min_batch_size
  order by count(*) desc, b.discovery_source asc;
$$;

create or replace function public.find_duplicate_books()
returns table (
  normalized_title text,
  normalized_author text,
  book_ids uuid[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(regexp_replace(b.title, '\s+', ' ', 'g')) as normalized_title,
    lower(regexp_replace(b.author, '\s+', ' ', 'g')) as normalized_author,
    array_agg(b.id order by b.is_canon desc, b.updated_at desc nulls last, b.created_at desc) as book_ids
  from public.books b
  where b.title is not null
    and b.author is not null
  group by 1, 2
  having count(*) > 1;
$$;

create or replace function public.find_series_orphans()
returns table (id uuid, title text, author text)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.title, b.author
  from public.books b
  where b.is_canon = true
    and b.goodreads_id is not null
    and b.series_name is null
    and exists (
      select 1
      from public.books sibling
      where sibling.author = b.author
        and sibling.id <> b.id
        and sibling.series_name is not null
    )
  order by b.updated_at asc nulls first, b.created_at asc
  limit 200;
$$;

create or replace function public.find_genre_only_spice_books()
returns table (book_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select s.book_id
  from public.spice_signals s
  where s.source = 'genre_bucketing'
    and not exists (
      select 1
      from public.spice_signals other
      where other.book_id = s.book_id
        and other.source in ('community', 'romance_io', 'review_classifier', 'llm_inference')
    );
$$;

create or replace function public.get_amazon_rating_pairs()
returns table (
  book_id uuid,
  title text,
  author text,
  existing_rating numeric,
  amazon_rating numeric,
  rating_delta numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id as book_id,
    b.title,
    b.author,
    gr.rating as existing_rating,
    ar.rating as amazon_rating,
    abs(ar.rating - gr.rating) as rating_delta
  from public.books b
  join public.book_ratings ar on ar.book_id = b.id and ar.source = 'amazon'
  join public.book_ratings gr on gr.book_id = b.id and gr.source = 'goodreads'
  where ar.rating is not null
    and gr.rating is not null
  order by abs(ar.rating - gr.rating) desc;
$$;

create or replace function public.count_distinct_book_tropes_by_source()
returns table (source text, book_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select bt.source, count(distinct bt.book_id)::bigint as book_count
  from public.book_tropes bt
  group by bt.source
  order by book_count desc, bt.source asc;
$$;

create or replace function public.refresh_creator_handle_stats()
returns void
language sql
security definer
set search_path = public
as $$
  update public.creator_handles ch
  set
    book_count = coalesce(stats.book_count, 0),
    grab_count = coalesce(stats.grab_count, 0),
    follower_count = coalesce(followers.follower_count, 0),
    last_grabbed_at = stats.last_grabbed_at,
    updated_at = now()
  from (
    select
      ch_inner.id,
      count(distinct cbm.book_id)::integer as book_count,
      count(distinct cbm.video_grab_id)::integer as grab_count,
      max(cbm.mentioned_at) as last_grabbed_at
    from public.creator_handles ch_inner
    left join public.creator_book_mentions cbm
      on cbm.creator_handle_id = ch_inner.id
    group by ch_inner.id
  ) stats
  left join (
    select creator_handle_id, count(*)::integer as follower_count
    from public.user_follows
    group by creator_handle_id
  ) followers on followers.creator_handle_id = stats.id
  where ch.id = stats.id;
$$;

revoke all on function public.get_unscanned_books_for_quality(integer)
  from public, anon, authenticated;
revoke all on function public.get_uncrawled_popular_authors(integer)
  from public, anon, authenticated;
revoke all on function public.get_recent_discovery_batches(integer, integer)
  from public, anon, authenticated;
revoke all on function public.find_duplicate_books()
  from public, anon, authenticated;
revoke all on function public.find_series_orphans()
  from public, anon, authenticated;
revoke all on function public.find_genre_only_spice_books()
  from public, anon, authenticated;
revoke all on function public.get_amazon_rating_pairs()
  from public, anon, authenticated;
revoke all on function public.count_distinct_book_tropes_by_source()
  from public, anon, authenticated;
revoke all on function public.refresh_creator_handle_stats()
  from public, anon, authenticated;

grant execute on function public.get_unscanned_books_for_quality(integer)
  to service_role;
grant execute on function public.get_uncrawled_popular_authors(integer)
  to service_role;
grant execute on function public.get_recent_discovery_batches(integer, integer)
  to service_role;
grant execute on function public.find_duplicate_books()
  to service_role;
grant execute on function public.find_series_orphans()
  to service_role;
grant execute on function public.find_genre_only_spice_books()
  to service_role;
grant execute on function public.get_amazon_rating_pairs()
  to service_role;
grant execute on function public.count_distinct_book_tropes_by_source()
  to service_role;
grant execute on function public.refresh_creator_handle_stats()
  to service_role;
