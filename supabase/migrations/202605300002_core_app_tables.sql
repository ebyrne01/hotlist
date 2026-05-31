-- First migration batch for app tables that were already used by code but not
-- represented in checked-in SQL. Definitions are additive/idempotent so they
-- can be applied to an existing Supabase project.

create extension if not exists "uuid-ossp";

-- Creator/profile columns used by creator approval, vanity profiles, and admin.
alter table public.profiles
  add column if not exists is_admin boolean not null default false,
  add column if not exists is_creator boolean not null default false,
  add column if not exists creator_verified_at timestamptz,
  add column if not exists vanity_slug text,
  add column if not exists bio text,
  add column if not exists tiktok_handle text,
  add column if not exists instagram_handle text,
  add column if not exists youtube_handle text,
  add column if not exists blog_url text,
  add column if not exists amazon_affiliate_tag text,
  add column if not exists bookshop_affiliate_id text;

create unique index if not exists profiles_vanity_slug_key
  on public.profiles (vanity_slug)
  where vanity_slug is not null;

-- Books columns added after the original bootstrap schema.
alter table public.books
  add column if not exists slug text,
  add column if not exists goodreads_url text,
  add column if not exists genres text[] not null default '{}',
  add column if not exists subgenre text,
  add column if not exists enrichment_status text not null default 'pending',
  add column if not exists metadata_source text,
  add column if not exists is_canon boolean not null default true,
  add column if not exists is_audiobook boolean not null default false,
  add column if not exists last_quality_scan timestamptz;

create unique index if not exists books_slug_key
  on public.books (slug)
  where slug is not null;

create index if not exists books_is_canon_idx on public.books (is_canon);
create index if not exists books_subgenre_idx on public.books (subgenre);
create index if not exists books_enrichment_status_idx on public.books (enrichment_status);

-- Reading status evolved from a simple status enum to pre/post-read responses.
alter table public.reading_status
  add column if not exists response text,
  add column if not exists is_reading boolean not null default false;

create index if not exists reading_status_user_response_idx
  on public.reading_status (user_id, response);

-- Multi-source spice architecture.
create table if not exists public.spice_signals (
  id uuid primary key default uuid_generate_v4(),
  book_id uuid not null references public.books(id) on delete cascade,
  source text not null,
  spice_value numeric(3,1) not null check (spice_value >= 0 and spice_value <= 5),
  confidence numeric(3,2) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, source)
);

create index if not exists spice_signals_book_id_idx
  on public.spice_signals (book_id);
create index if not exists spice_signals_source_idx
  on public.spice_signals (source);
create index if not exists spice_signals_updated_at_idx
  on public.spice_signals (updated_at);

alter table public.spice_signals enable row level security;

drop policy if exists "Spice signals are public" on public.spice_signals;
create policy "Spice signals are public"
  on public.spice_signals
  for select
  using (true);

drop policy if exists "Service role can write spice signals" on public.spice_signals;
create policy "Service role can write spice signals"
  on public.spice_signals
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Async enrichment queue.
create table if not exists public.enrichment_queue (
  id uuid primary key default uuid_generate_v4(),
  book_id uuid not null references public.books(id) on delete cascade,
  job_type text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  next_retry_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  completed_at timestamptz,
  error_message text,
  outcome text,
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, job_type)
);

create index if not exists enrichment_queue_status_retry_idx
  on public.enrichment_queue (status, next_retry_at);
create index if not exists enrichment_queue_book_id_idx
  on public.enrichment_queue (book_id);
create index if not exists enrichment_queue_job_type_idx
  on public.enrichment_queue (job_type);

alter table public.enrichment_queue enable row level security;

drop policy if exists "Service role manages enrichment queue" on public.enrichment_queue;
create policy "Service role manages enrichment queue"
  on public.enrichment_queue
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.claim_enrichment_jobs(
  p_limit integer default 10,
  p_job_types text[] default null
)
returns table (
  id uuid,
  book_id uuid,
  job_type text,
  attempts integer,
  max_attempts integer,
  book_title text,
  book_author text,
  book_isbn text,
  book_goodreads_id text
)
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select q.id
    from public.enrichment_queue q
    where q.status in ('pending', 'failed')
      and q.next_retry_at <= now()
      and q.attempts < q.max_attempts
      and (p_job_types is null or q.job_type = any(p_job_types))
    order by q.next_retry_at asc, q.created_at asc
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.enrichment_queue q
    set
      status = 'running',
      attempts = q.attempts + 1,
      last_attempt_at = now(),
      updated_at = now()
    from candidates c
    where q.id = c.id
    returning q.*
  )
  select
    c.id,
    c.book_id,
    c.job_type,
    c.attempts,
    c.max_attempts,
    b.title as book_title,
    b.author as book_author,
    b.isbn as book_isbn,
    b.goodreads_id as book_goodreads_id
  from claimed c
  join public.books b on b.id = c.book_id;
$$;

revoke all on function public.claim_enrichment_jobs(integer, text[])
  from public, anon, authenticated;
grant execute on function public.claim_enrichment_jobs(integer, text[])
  to service_role;

-- Quality flags for rules engine, Haiku scanner, admin triage, and feedback.
create table if not exists public.quality_flags (
  id uuid primary key default uuid_generate_v4(),
  book_id uuid not null references public.books(id) on delete cascade,
  field_name text not null,
  issue_type text not null,
  source text not null,
  priority text not null default 'P2',
  rule_id text,
  confidence numeric(3,2) not null default 1.0 check (confidence >= 0 and confidence <= 1),
  original_value text,
  suggested_value text,
  auto_fixable boolean not null default false,
  status text not null default 'open',
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists quality_flags_open_unique_idx
  on public.quality_flags (book_id, field_name, issue_type)
  where status = 'open';
create index if not exists quality_flags_status_priority_idx
  on public.quality_flags (status, priority, created_at desc);
create index if not exists quality_flags_issue_source_idx
  on public.quality_flags (issue_type, source);

alter table public.quality_flags enable row level security;

drop policy if exists "Admins can insert quality flags" on public.quality_flags;
create policy "Admins can insert quality flags"
  on public.quality_flags
  for insert
  with check (
    auth.role() = 'service_role'
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_admin = true
    )
  );

drop policy if exists "Service role manages quality flags" on public.quality_flags;
create policy "Service role manages quality flags"
  on public.quality_flags
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Creator discovery and claim system.
create table if not exists public.creator_handles (
  id uuid primary key default uuid_generate_v4(),
  handle text not null,
  platform text not null,
  grab_count integer not null default 0,
  book_count integer not null default 0,
  follower_count integer not null default 0,
  last_grabbed_at timestamptz,
  claimed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (handle, platform)
);

create index if not exists creator_handles_grab_count_idx
  on public.creator_handles (grab_count desc);
create index if not exists creator_handles_book_count_idx
  on public.creator_handles (book_count desc);
create index if not exists creator_handles_claimed_by_idx
  on public.creator_handles (claimed_by);

alter table public.creator_handles enable row level security;

drop policy if exists "Creator handles are public" on public.creator_handles;
create policy "Creator handles are public"
  on public.creator_handles
  for select
  using (true);

drop policy if exists "Service role manages creator handles" on public.creator_handles;
create policy "Service role manages creator handles"
  on public.creator_handles
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.increment_grab_count(handle_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.creator_handles
  set grab_count = grab_count + 1,
      updated_at = now()
  where id = handle_id;
$$;

create table if not exists public.creator_book_mentions (
  id uuid primary key default uuid_generate_v4(),
  creator_handle_id uuid not null references public.creator_handles(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  video_grab_id uuid references public.video_grabs(id) on delete set null,
  sentiment text,
  quote text,
  platform text,
  video_url text,
  mentioned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (creator_handle_id, book_id, video_grab_id)
);

create index if not exists creator_book_mentions_creator_idx
  on public.creator_book_mentions (creator_handle_id, mentioned_at desc);
create index if not exists creator_book_mentions_book_idx
  on public.creator_book_mentions (book_id);

alter table public.creator_book_mentions enable row level security;

drop policy if exists "Creator mentions are public" on public.creator_book_mentions;
create policy "Creator mentions are public"
  on public.creator_book_mentions
  for select
  using (true);

drop policy if exists "Service role manages creator mentions" on public.creator_book_mentions;
create policy "Service role manages creator mentions"
  on public.creator_book_mentions
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.count_distinct_creator_books(cid uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(distinct book_id)::integer
  from public.creator_book_mentions
  where creator_handle_id = cid;
$$;

revoke all on function public.increment_grab_count(uuid)
  from public, anon, authenticated;
grant execute on function public.increment_grab_count(uuid)
  to service_role;

revoke all on function public.count_distinct_creator_books(uuid)
  from public, anon, authenticated;
grant execute on function public.count_distinct_creator_books(uuid)
  to service_role;

-- Creator applications are user-owned, reviewed by admin service routes.
create table if not exists public.creator_applications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null,
  handle text not null,
  follower_count integer not null default 0,
  content_description text,
  status text not null default 'pending',
  reviewer_note text,
  reviewed_at timestamptz,
  claim_handle_id uuid references public.creator_handles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creator_applications_user_idx
  on public.creator_applications (user_id, status);
create index if not exists creator_applications_status_idx
  on public.creator_applications (status, created_at desc);

alter table public.creator_applications enable row level security;

drop policy if exists "Users see own creator applications" on public.creator_applications;
create policy "Users see own creator applications"
  on public.creator_applications
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users create own creator applications" on public.creator_applications;
create policy "Users create own creator applications"
  on public.creator_applications
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own rejected creator applications" on public.creator_applications;
create policy "Users delete own rejected creator applications"
  on public.creator_applications
  for delete
  using (auth.uid() = user_id and status = 'rejected');

drop policy if exists "Service role manages creator applications" on public.creator_applications;
create policy "Service role manages creator applications"
  on public.creator_applications
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Lightweight analytics event tracking.
create table if not exists public.analytics_events (
  id uuid primary key default uuid_generate_v4(),
  event_type text not null,
  profile_id uuid references public.profiles(id) on delete set null,
  hotlist_id uuid references public.hotlists(id) on delete set null,
  book_id uuid references public.books(id) on delete set null,
  referrer text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_event_type_idx
  on public.analytics_events (event_type, created_at desc);
create index if not exists analytics_events_profile_idx
  on public.analytics_events (profile_id, created_at desc);
create index if not exists analytics_events_book_idx
  on public.analytics_events (book_id, created_at desc);
create index if not exists analytics_events_hotlist_idx
  on public.analytics_events (hotlist_id, created_at desc);

alter table public.analytics_events enable row level security;

drop policy if exists "Service role manages analytics events" on public.analytics_events;
create policy "Service role manages analytics events"
  on public.analytics_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Buzz events created by discovery channels and creator mentions.
create table if not exists public.book_buzz_signals (
  id uuid primary key default uuid_generate_v4(),
  book_id uuid not null references public.books(id) on delete cascade,
  source text not null,
  signal_date date not null default current_date,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (book_id, source, signal_date)
);

create index if not exists book_buzz_signals_book_idx
  on public.book_buzz_signals (book_id, signal_date desc);
create index if not exists book_buzz_signals_source_date_idx
  on public.book_buzz_signals (source, signal_date desc);

alter table public.book_buzz_signals enable row level security;

drop policy if exists "Book buzz signals are public" on public.book_buzz_signals;
create policy "Book buzz signals are public"
  on public.book_buzz_signals
  for select
  using (true);

drop policy if exists "Service role manages book buzz signals" on public.book_buzz_signals;
create policy "Service role manages book buzz signals"
  on public.book_buzz_signals
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Public follower relationships for creator discovery.
create table if not exists public.user_follows (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  creator_handle_id uuid not null references public.creator_handles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, creator_handle_id)
);

create index if not exists user_follows_creator_idx
  on public.user_follows (creator_handle_id);

alter table public.user_follows enable row level security;

drop policy if exists "Users see own follows" on public.user_follows;
create policy "Users see own follows"
  on public.user_follows
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users manage own follows" on public.user_follows;
create policy "Users manage own follows"
  on public.user_follows
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Service role can read follows" on public.user_follows;
create policy "Service role can read follows"
  on public.user_follows
  for select
  using (auth.role() = 'service_role');

create or replace function public.count_followers_batch(handle_ids uuid[])
returns table (creator_handle_id uuid, count bigint)
language sql
security definer
set search_path = public
as $$
  select uf.creator_handle_id, count(*)::bigint
  from public.user_follows uf
  where uf.creator_handle_id = any(handle_ids)
  group by uf.creator_handle_id;
$$;

grant execute on function public.count_followers_batch(uuid[])
  to anon, authenticated, service_role;
