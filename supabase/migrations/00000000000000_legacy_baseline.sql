-- Idempotent baseline for the schema that originally predated migration
-- tracking. Keep this first so fresh databases and development branches can
-- replay the complete migration chain.

create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;

create table if not exists public.books (
  id uuid primary key default uuid_generate_v4(),
  isbn text unique,
  isbn13 text unique,
  google_books_id text unique,
  title text not null,
  author text not null,
  series_name text,
  series_position integer,
  cover_url text,
  page_count integer,
  published_year integer,
  publisher text,
  description text,
  ai_synopsis text,
  goodreads_id text unique,
  amazon_asin text unique,
  romance_io_slug text unique,
  romance_io_heat_label text,
  quality_score integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  data_refreshed_at timestamptz
);

create index if not exists books_search_idx on public.books
  using gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(author, '')));

create table if not exists public.book_ratings (
  id uuid primary key default uuid_generate_v4(),
  book_id uuid references public.books(id) on delete cascade,
  source text not null check (source in ('goodreads', 'amazon', 'romance_io')),
  rating numeric(3,2),
  rating_count integer,
  scraped_at timestamptz default now(),
  unique (book_id, source)
);

create table if not exists public.book_spice (
  id uuid primary key default uuid_generate_v4(),
  book_id uuid references public.books(id) on delete cascade,
  source text not null check (source in ('romance_io', 'hotlist_community', 'goodreads_inference')),
  spice_level integer check (spice_level between 1 and 5),
  confidence text check (confidence in ('high', 'medium', 'low')),
  rating_count integer default 0,
  scraped_at timestamptz default now(),
  unique (book_id, source)
);

create table if not exists public.tropes (
  id uuid primary key default uuid_generate_v4(),
  slug text unique not null,
  name text not null,
  description text,
  sort_order integer default 0
);

create table if not exists public.book_tropes (
  book_id uuid references public.books(id) on delete cascade,
  trope_id uuid references public.tropes(id) on delete cascade,
  source text default 'scraped',
  primary key (book_id, trope_id)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  pro_waitlist boolean default false,
  created_at timestamptz default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user()
  from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table if not exists public.reading_status (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  book_id uuid references public.books(id) on delete cascade,
  status text not null check (status in ('want_to_read', 'reading', 'read')),
  updated_at timestamptz default now(),
  unique (user_id, book_id)
);

create table if not exists public.user_ratings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  book_id uuid references public.books(id) on delete cascade,
  star_rating integer check (star_rating between 1 and 5),
  spice_rating integer check (spice_rating between 1 and 5),
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, book_id)
);

create table if not exists public.hotlists (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  is_public boolean default false,
  share_slug text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.hotlist_books (
  id uuid primary key default uuid_generate_v4(),
  hotlist_id uuid references public.hotlists(id) on delete cascade,
  book_id uuid references public.books(id) on delete cascade,
  position integer default 0,
  added_at timestamptz default now(),
  unique (hotlist_id, book_id)
);

create table if not exists public.pro_waitlist (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  user_id uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists public.video_grabs (
  id uuid primary key default uuid_generate_v4(),
  url text unique not null,
  platform text,
  creator_handle text,
  thumbnail_url text,
  transcript text,
  extracted_books jsonb,
  processed_at timestamptz default now(),
  user_id uuid references auth.users(id)
);

create table if not exists public.creator_handles (
  id uuid primary key default uuid_generate_v4(),
  handle text not null,
  platform text not null default 'tiktok',
  display_name text,
  avatar_url text,
  bio text,
  follower_count integer not null default 0,
  book_count integer not null default 0,
  grab_count integer not null default 0,
  claimed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (handle, platform)
);

create table if not exists public.creator_applications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  application_note text,
  reviewer_note text,
  reviewed_at timestamptz,
  claim_handle_id uuid references public.creator_handles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.books enable row level security;
drop policy if exists "Books are public" on public.books;
create policy "Books are public" on public.books for select using (true);

alter table public.book_ratings enable row level security;
drop policy if exists "Ratings are public" on public.book_ratings;
create policy "Ratings are public" on public.book_ratings for select using (true);

alter table public.book_spice enable row level security;
drop policy if exists "Spice is public" on public.book_spice;
create policy "Spice is public" on public.book_spice for select using (true);

alter table public.tropes enable row level security;
drop policy if exists "Tropes are public" on public.tropes;
create policy "Tropes are public" on public.tropes for select using (true);

alter table public.book_tropes enable row level security;
drop policy if exists "Book tropes are public" on public.book_tropes;
create policy "Book tropes are public" on public.book_tropes for select using (true);

alter table public.profiles enable row level security;
drop policy if exists "Profiles are public" on public.profiles;
create policy "Profiles are public" on public.profiles for select using (true);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update
  using ((select auth.uid()) = id);
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles for insert
  with check ((select auth.uid()) = id);
drop policy if exists "Users can delete own profile" on public.profiles;
create policy "Users can delete own profile" on public.profiles for delete
  using ((select auth.uid()) = id);

alter table public.reading_status enable row level security;
drop policy if exists "Users see own reading status" on public.reading_status;
drop policy if exists "Users manage own reading status" on public.reading_status;
create policy "Users manage own reading status" on public.reading_status for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.user_ratings enable row level security;
drop policy if exists "Users see own ratings" on public.user_ratings;
drop policy if exists "Users manage own ratings" on public.user_ratings;
create policy "Users manage own ratings" on public.user_ratings for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.hotlists enable row level security;
drop policy if exists "Owner sees all their hotlists" on public.hotlists;
drop policy if exists "Public lists are readable" on public.hotlists;
create policy "Public lists are readable" on public.hotlists for select
  using (is_public = true);
drop policy if exists "Owner manages hotlists" on public.hotlists;
create policy "Owner manages hotlists" on public.hotlists for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.hotlist_books enable row level security;
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

alter table public.pro_waitlist enable row level security;
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

alter table public.video_grabs enable row level security;
drop policy if exists "Video grabs are public" on public.video_grabs;
create policy "Video grabs are public" on public.video_grabs for select using (true);
drop policy if exists "Authenticated users can create grabs" on public.video_grabs;
create policy "Authenticated users can create grabs" on public.video_grabs for insert
  with check ((select auth.uid()) = user_id);

alter table public.creator_handles enable row level security;
drop policy if exists "Creator handles are public" on public.creator_handles;
create policy "Creator handles are public" on public.creator_handles for select using (true);

alter table public.creator_applications enable row level security;
drop policy if exists "Users see own creator applications" on public.creator_applications;
create policy "Users see own creator applications" on public.creator_applications for select
  using ((select auth.uid()) = user_id);
drop policy if exists "Users create own creator applications" on public.creator_applications;
create policy "Users create own creator applications" on public.creator_applications for insert
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete own rejected creator applications" on public.creator_applications;
create policy "Users delete own rejected creator applications" on public.creator_applications for delete
  using ((select auth.uid()) = user_id and status = 'rejected');

insert into public.tropes (slug, name, sort_order) values
  ('enemies-to-lovers', 'Enemies to Lovers', 1),
  ('slow-burn', 'Slow Burn', 2),
  ('forced-proximity', 'Forced Proximity', 3),
  ('second-chance', 'Second Chance', 4),
  ('fake-dating', 'Fake Dating', 5),
  ('grumpy-sunshine', 'Grumpy / Sunshine', 6),
  ('forbidden-romance', 'Forbidden Romance', 7),
  ('fae-faerie', 'Fae / Faerie', 8),
  ('chosen-one', 'Chosen One', 9),
  ('instalove', 'Insta-love', 10),
  ('age-gap', 'Age Gap', 11),
  ('reverse-harem', 'Reverse Harem', 12),
  ('arranged-marriage', 'Arranged Marriage', 13),
  ('bodyguard-romance', 'Bodyguard Romance', 14),
  ('sports-romance', 'Sports Romance', 15),
  ('small-town', 'Small Town', 16),
  ('billionaire', 'Billionaire', 17),
  ('dark-romance', 'Dark Romance', 18),
  ('vampire', 'Vampire', 19),
  ('shifter', 'Shifter', 20),
  ('mafia-romance', 'Mafia Romance', 21),
  ('office-romance', 'Office Romance', 22),
  ('holiday-romance', 'Holiday Romance', 23),
  ('friends-to-lovers', 'Friends to Lovers', 24),
  ('love-triangle', 'Love Triangle', 25)
on conflict (slug) do nothing;
