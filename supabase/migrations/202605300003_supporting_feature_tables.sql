-- Second schema backlog batch: feature support tables, caches, logs, and a
-- handful of straightforward helper RPCs referenced by existing code.

create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;

-- AI recommendation cache.
create table if not exists public.book_recommendations (
  id uuid primary key default uuid_generate_v4(),
  book_id uuid not null references public.books(id) on delete cascade,
  recommended_book_id uuid not null references public.books(id) on delete cascade,
  reason text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (book_id, recommended_book_id)
);

create index if not exists book_recommendations_book_position_idx
  on public.book_recommendations (book_id, position);

alter table public.book_recommendations enable row level security;

drop policy if exists "Book recommendations are public" on public.book_recommendations;
create policy "Book recommendations are public"
  on public.book_recommendations for select using (true);

drop policy if exists "Service role manages book recommendations" on public.book_recommendations;
create policy "Service role manages book recommendations"
  on public.book_recommendations
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Curated discussion links found during enrichment.
create table if not exists public.book_discussion_links (
  id uuid primary key default uuid_generate_v4(),
  book_id uuid not null references public.books(id) on delete cascade,
  url text not null,
  title text not null,
  source text not null,
  source_detail text,
  comment_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, url)
);

create index if not exists book_discussion_links_book_idx
  on public.book_discussion_links (book_id);

alter table public.book_discussion_links enable row level security;

drop policy if exists "Discussion links are public" on public.book_discussion_links;
create policy "Discussion links are public"
  on public.book_discussion_links for select using (true);

drop policy if exists "Service role manages discussion links" on public.book_discussion_links;
create policy "Service role manages discussion links"
  on public.book_discussion_links
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Creator share-card editor/cache.
create table if not exists public.creator_share_cards (
  id uuid primary key default uuid_generate_v4(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  spice_override integer check (spice_override between 1 and 5),
  tropes_selected text[] not null default '{}',
  creator_quote text,
  aspect_ratio text not null default '9:16',
  source_video_url text,
  view_count integer not null default 0,
  export_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (creator_id, book_id)
);

create index if not exists creator_share_cards_creator_idx
  on public.creator_share_cards (creator_id, updated_at desc);
create index if not exists creator_share_cards_book_idx
  on public.creator_share_cards (book_id);

alter table public.creator_share_cards enable row level security;

drop policy if exists "Share cards are public" on public.creator_share_cards;
create policy "Share cards are public"
  on public.creator_share_cards for select using (true);

drop policy if exists "Creators manage own share cards" on public.creator_share_cards;
create policy "Creators manage own share cards"
  on public.creator_share_cards
  for all
  using (auth.uid() = creator_id)
  with check (auth.uid() = creator_id);

drop policy if exists "Service role manages share cards" on public.creator_share_cards;
create policy "Service role manages share cards"
  on public.creator_share_cards
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Debug traces from BookTok agent runs. Admin-only route reads these via service role.
create table if not exists public.agent_debug_logs (
  id uuid primary key default uuid_generate_v4(),
  url text not null,
  log_entries jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index if not exists agent_debug_logs_url_created_idx
  on public.agent_debug_logs (url, created_at desc);

alter table public.agent_debug_logs enable row level security;

drop policy if exists "Service role manages agent debug logs" on public.agent_debug_logs;
create policy "Service role manages agent debug logs"
  on public.agent_debug_logs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Anonymous/user feedback on grab results.
create table if not exists public.grab_feedback (
  id uuid primary key default uuid_generate_v4(),
  video_url text not null,
  book_id uuid references public.books(id) on delete set null,
  book_title text,
  feedback_type text not null,
  notes text,
  user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create index if not exists grab_feedback_status_idx
  on public.grab_feedback (status, created_at desc);
create index if not exists grab_feedback_book_idx
  on public.grab_feedback (book_id);

alter table public.grab_feedback enable row level security;

drop policy if exists "Anyone can submit grab feedback" on public.grab_feedback;
create policy "Anyone can submit grab feedback"
  on public.grab_feedback for insert with check (true);

drop policy if exists "Service role manages grab feedback" on public.grab_feedback;
create policy "Service role manages grab feedback"
  on public.grab_feedback
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Private DNF reason notes.
create table if not exists public.dnf_reasons (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  tags text[] not null default '{}',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, book_id)
);

alter table public.dnf_reasons enable row level security;

drop policy if exists "Users manage own DNF reasons" on public.dnf_reasons;
create policy "Users manage own DNF reasons"
  on public.dnf_reasons
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Serper and search intent caches.
create table if not exists public.serper_query_cache (
  query_hash text primary key,
  query_text text,
  result_status text not null,
  miss_count integer not null default 0,
  queried_at timestamptz not null default now()
);

create index if not exists serper_query_cache_queried_at_idx
  on public.serper_query_cache (queried_at);

alter table public.serper_query_cache enable row level security;

drop policy if exists "Service role manages Serper cache" on public.serper_query_cache;
create policy "Service role manages Serper cache"
  on public.serper_query_cache
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create table if not exists public.search_intent_cache (
  query_hash text primary key,
  query_text text not null,
  filters jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists search_intent_cache_created_at_idx
  on public.search_intent_cache (created_at);

alter table public.search_intent_cache enable row level security;

drop policy if exists "Service role manages search intent cache" on public.search_intent_cache;
create policy "Service role manages search intent cache"
  on public.search_intent_cache
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Search analytics and direct search-result feedback.
create table if not exists public.search_analytics (
  id uuid primary key default uuid_generate_v4(),
  query_text text not null,
  intent_type text,
  filters jsonb,
  result_count integer,
  latency_ms integer,
  feedback integer check (feedback in (-1, 1)),
  feedback_note text,
  created_at timestamptz not null default now()
);

create index if not exists search_analytics_created_at_idx
  on public.search_analytics (created_at desc);

alter table public.search_analytics enable row level security;

drop policy if exists "Service role manages search analytics" on public.search_analytics;
create policy "Service role manages search analytics"
  on public.search_analytics
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Operational logs and health snapshots.
create table if not exists public.cron_logs (
  id uuid primary key default uuid_generate_v4(),
  job_name text not null,
  status text not null,
  books_added integer,
  books_updated integer,
  errors text[] not null default '{}',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists cron_logs_job_created_idx
  on public.cron_logs (job_name, created_at desc);

alter table public.cron_logs enable row level security;

drop policy if exists "Service role manages cron logs" on public.cron_logs;
create policy "Service role manages cron logs"
  on public.cron_logs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create table if not exists public.quality_health_log (
  id uuid primary key default uuid_generate_v4(),
  computed_at timestamptz not null default now(),
  canon_count integer not null default 0,
  coverage jsonb not null default '{}',
  flags jsonb not null default '{}',
  enrichment jsonb not null default '{}',
  search_eval jsonb,
  created_at timestamptz not null default now()
);

create index if not exists quality_health_log_computed_at_idx
  on public.quality_health_log (computed_at desc);

alter table public.quality_health_log enable row level security;

drop policy if exists "Service role manages quality health log" on public.quality_health_log;
create policy "Service role manages quality health log"
  on public.quality_health_log
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Harvest logs from admin extension/API.
create table if not exists public.harvest_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete set null,
  books_submitted integer not null default 0,
  books_added integer not null default 0,
  books_updated integer not null default 0,
  books_skipped integer not null default 0,
  sources text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists harvest_log_created_at_idx
  on public.harvest_log (created_at desc);

alter table public.harvest_log enable row level security;

drop policy if exists "Service role manages harvest log" on public.harvest_log;
create policy "Service role manages harvest log"
  on public.harvest_log
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- NYT discovery cache.
create table if not exists public.nyt_trending (
  id uuid primary key default uuid_generate_v4(),
  book_id uuid not null references public.books(id) on delete cascade,
  list_name text not null,
  rank integer,
  weeks_on_list integer,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (book_id, list_name)
);

create index if not exists nyt_trending_expires_at_idx
  on public.nyt_trending (expires_at);

alter table public.nyt_trending enable row level security;

drop policy if exists "NYT trending is public" on public.nyt_trending;
create policy "NYT trending is public"
  on public.nyt_trending for select using (true);

drop policy if exists "Service role manages NYT trending" on public.nyt_trending;
create policy "Service role manages NYT trending"
  on public.nyt_trending
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Fuzzy search helpers.
create or replace function public.fuzzy_book_search(
  search_query text,
  result_limit integer default 15
)
returns setof public.books
language sql
stable
security definer
set search_path = public
as $$
  select b.*
  from public.books b
  where b.is_canon = true
  order by greatest(
    similarity(coalesce(b.title, ''), search_query),
    similarity(coalesce(b.author, ''), search_query)
  ) desc
  limit result_limit;
$$;

create or replace function public.search_books_fuzzy(
  search_query text,
  result_limit integer default 10
)
returns table (
  id uuid,
  title text,
  author text,
  goodreads_id text,
  series_name text,
  series_position integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.title,
    b.author,
    b.goodreads_id,
    b.series_name,
    b.series_position
  from public.books b
  where b.is_canon = true
  order by greatest(
    similarity(coalesce(b.title, ''), search_query),
    similarity(coalesce(b.author, ''), search_query)
  ) desc
  limit result_limit;
$$;

grant execute on function public.fuzzy_book_search(text, integer)
  to anon, authenticated, service_role;
grant execute on function public.search_books_fuzzy(text, integer)
  to service_role;

create or replace function public.get_top_tropes_for_user(
  p_user_id uuid,
  p_limit integer default 3
)
returns table (name text, slug text, count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.name, t.slug, count(*)::bigint
  from public.reading_status rs
  join public.book_tropes bt on bt.book_id = rs.book_id
  join public.tropes t on t.id = bt.trope_id
  where rs.user_id = p_user_id
    and (rs.status = 'read' or rs.response in ('loved_it', 'it_was_fine', 'didnt_finish'))
  group by t.name, t.slug
  order by count(*) desc, t.name asc
  limit p_limit;
$$;

grant execute on function public.get_top_tropes_for_user(uuid, integer)
  to service_role;

create or replace function public.get_books_missing_amazon_rating()
returns table (book_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select b.id
  from public.books b
  where b.is_canon = true
    and not exists (
      select 1
      from public.book_ratings br
      where br.book_id = b.id
        and br.source = 'amazon'
        and br.rating is not null
    );
$$;

grant execute on function public.get_books_missing_amazon_rating()
  to service_role;

create or replace function public.count_canon_with_recommendations()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct b.id)::integer
  from public.books b
  join public.book_recommendations r on r.book_id = b.id
  where b.is_canon = true;
$$;

create or replace function public.count_canon_with_source(source_name text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct b.id)::integer
  from public.books b
  join public.book_ratings br on br.book_id = b.id
  where b.is_canon = true
    and br.source = source_name
    and br.rating is not null;
$$;

create or replace function public.count_canon_with_spice_source(source_name text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct b.id)::integer
  from public.books b
  join public.spice_signals s on s.book_id = b.id
  where b.is_canon = true
    and s.source = source_name;
$$;

create or replace function public.count_canon_with_tropes()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct b.id)::integer
  from public.books b
  join public.book_tropes bt on bt.book_id = b.id
  where b.is_canon = true;
$$;

grant execute on function public.count_canon_with_recommendations()
  to service_role;
grant execute on function public.count_canon_with_source(text)
  to service_role;
grant execute on function public.count_canon_with_spice_source(text)
  to service_role;
grant execute on function public.count_canon_with_tropes()
  to service_role;
