-- Source-health reporting filters enrichment jobs by updated_at. Production
-- had outcome/status tracking without this timestamp, which made health checks
-- fail even when workers ran successfully.

alter table public.enrichment_queue
  add column if not exists updated_at timestamptz not null default now();

create index if not exists enrichment_queue_updated_at_idx
  on public.enrichment_queue (updated_at);

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
