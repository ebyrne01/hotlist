-- Demand-gated discovery queue.
-- Stores title demand signals before we spend enrichment budget.

create table if not exists public.discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  title_norm text not null,
  author_norm text not null default '',
  source text not null,
  source_url text,
  source_rank integer,
  category text,
  demand_score integer not null default 0,
  occurrence_count integer not null default 1,
  status text not null default 'new'
    check (status in ('new', 'resolved', 'ignored', 'enriched')),
  resolved_book_id uuid references public.books(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists discovery_candidates_source_identity_idx
  on public.discovery_candidates (source, title_norm, author_norm);

create index if not exists discovery_candidates_priority_idx
  on public.discovery_candidates (status, demand_score desc, last_seen_at desc);

create index if not exists discovery_candidates_category_idx
  on public.discovery_candidates (category, last_seen_at desc)
  where category is not null;

alter table public.discovery_candidates enable row level security;

drop policy if exists "Service role manages discovery candidates"
  on public.discovery_candidates;
create policy "Service role manages discovery candidates"
  on public.discovery_candidates
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.set_discovery_candidates_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_discovery_candidates_updated_at
  on public.discovery_candidates;
create trigger trg_discovery_candidates_updated_at
  before update on public.discovery_candidates
  for each row execute function public.set_discovery_candidates_updated_at();
