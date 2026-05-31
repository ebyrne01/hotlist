-- Durable fixed-window rate limits for paid or operational API endpoints.
-- Identifiers are hashed by the application before they are stored here.

create table if not exists public.api_rate_limits (
  bucket text not null,
  identifier_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (bucket, identifier_hash)
);

create index if not exists api_rate_limits_updated_at_idx
  on public.api_rate_limits (updated_at);

alter table public.api_rate_limits enable row level security;

drop policy if exists "Service role manages API rate limits" on public.api_rate_limits;
create policy "Service role manages API rate limits"
  on public.api_rate_limits
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.check_api_rate_limit(
  p_bucket text,
  p_identifier_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_reset_at timestamptz;
  v_count integer;
begin
  if p_limit < 1 then
    raise exception 'p_limit must be at least 1';
  end if;

  if p_window_seconds < 1 then
    raise exception 'p_window_seconds must be at least 1';
  end if;

  v_window_start :=
    to_timestamp(
      floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
    );
  v_reset_at := v_window_start + make_interval(secs => p_window_seconds);

  insert into public.api_rate_limits (
    bucket,
    identifier_hash,
    window_start,
    request_count,
    updated_at
  )
  values (
    p_bucket,
    p_identifier_hash,
    v_window_start,
    1,
    now()
  )
  on conflict (bucket, identifier_hash)
  do update set
    window_start = case
      when public.api_rate_limits.window_start < v_window_start
        then v_window_start
      else public.api_rate_limits.window_start
    end,
    request_count = case
      when public.api_rate_limits.window_start < v_window_start
        then 1
      else public.api_rate_limits.request_count + 1
    end,
    updated_at = now()
  returning request_count into v_count;

  return query
    select
      v_count <= p_limit,
      greatest(p_limit - v_count, 0),
      v_reset_at;
end;
$$;

revoke all on function public.check_api_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_api_rate_limit(text, text, integer, integer)
  to service_role;
