-- ============================================================
-- HOTLIST 🔥 — Supabase Database Schema
-- Run this in the Supabase SQL Editor (in order)
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ────────────────────────────────────────────────────────────
-- BOOKS
-- Canonical book records. Populated from Google Books API,
-- Open Library, and scraping. Cached here to avoid re-fetching.
-- ────────────────────────────────────────────────────────────
create table books (
  id              uuid primary key default uuid_generate_v4(),
  isbn            text unique,
  isbn13          text unique,
  google_books_id text unique,
  title           text not null,
  author          text not null,
  series_name     text,
  series_position integer,
  cover_url       text,
  page_count      integer,
  published_year  integer,
  publisher       text,
  description     text,          -- raw publisher description
  ai_synopsis     text,          -- AI-generated synopsis (Haiku)
  goodreads_id    text unique,
  amazon_asin     text unique,
  romance_io_slug text unique,
  romance_io_heat_label text,   -- e.g. 'Explicit open door', 'Behind closed doors'
  quality_score   integer default 0, -- computed quality score (0-7) for filtering
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  data_refreshed_at timestamptz  -- when external data was last fetched
);

-- Full text search on title + author
create index books_search_idx on books
  using gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(author,'')));

-- ────────────────────────────────────────────────────────────
-- BOOK RATINGS
-- One row per book per source. Updated on each data refresh.
-- ────────────────────────────────────────────────────────────
create table book_ratings (
  id          uuid primary key default uuid_generate_v4(),
  book_id     uuid references books(id) on delete cascade,
  source      text not null check (source in ('goodreads','amazon','romance_io')),
  rating      numeric(3,2),      -- e.g. 4.23
  rating_count integer,
  scraped_at  timestamptz default now(),
  unique(book_id, source)
);

-- ────────────────────────────────────────────────────────────
-- SPICE RATINGS
-- Separate from general ratings. Source can be 'romance_io'
-- or 'hotlist_community' (aggregated from user_ratings).
-- ────────────────────────────────────────────────────────────
create table book_spice (
  id          uuid primary key default uuid_generate_v4(),
  book_id     uuid references books(id) on delete cascade,
  source      text not null check (source in ('romance_io','hotlist_community','goodreads_inference')),
  spice_level integer check (spice_level between 1 and 5),
  confidence  text check (confidence in ('high','medium','low')),
  rating_count integer default 0,
  scraped_at  timestamptz default now(),
  unique(book_id, source)
);

-- ────────────────────────────────────────────────────────────
-- TROPES
-- Canonical trope list. Seeded from romance.io taxonomy.
-- ────────────────────────────────────────────────────────────
create table tropes (
  id          uuid primary key default uuid_generate_v4(),
  slug        text unique not null,  -- e.g. 'enemies-to-lovers'
  name        text not null,         -- e.g. 'Enemies to Lovers'
  description text,
  sort_order  integer default 0
);

-- Junction: books ↔ tropes
create table book_tropes (
  book_id   uuid references books(id) on delete cascade,
  trope_id  uuid references tropes(id) on delete cascade,
  source    text default 'scraped',  -- 'scraped' | 'community'
  primary key (book_id, trope_id)
);

-- ────────────────────────────────────────────────────────────
-- PROFILES
-- Extended user data (Supabase Auth handles the auth row).
-- ────────────────────────────────────────────────────────────
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique,
  display_name  text,
  avatar_url    text,
  pro_waitlist  boolean default false,
  created_at    timestamptz default now()
);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ────────────────────────────────────────────────────────────
-- READING STATUS
-- Per user per book: want_to_read | reading | read
-- ────────────────────────────────────────────────────────────
create table reading_status (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users(id) on delete cascade,
  book_id    uuid references books(id) on delete cascade,
  status     text not null check (status in ('want_to_read','reading','read')),
  updated_at timestamptz default now(),
  unique(user_id, book_id)
);

-- ────────────────────────────────────────────────────────────
-- USER RATINGS
-- Personal star rating + spice rating + optional note.
-- ────────────────────────────────────────────────────────────
create table user_ratings (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid references auth.users(id) on delete cascade,
  book_id      uuid references books(id) on delete cascade,
  star_rating  integer check (star_rating between 1 and 5),
  spice_rating integer check (spice_rating between 1 and 5),
  note         text,              -- private reading journal note
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique(user_id, book_id)
);

-- ────────────────────────────────────────────────────────────
-- HOTLISTS
-- Named comparison lists owned by users.
-- ────────────────────────────────────────────────────────────
create table hotlists (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade,
  name        text not null,
  is_public   boolean default false,  -- false = private, true = shareable link
  share_slug  text unique,            -- short slug for sharing e.g. /lists/fae-august
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Books within a hotlist, with user's display order
create table hotlist_books (
  id          uuid primary key default uuid_generate_v4(),
  hotlist_id  uuid references hotlists(id) on delete cascade,
  book_id     uuid references books(id) on delete cascade,
  position    integer default 0,
  added_at    timestamptz default now(),
  unique(hotlist_id, book_id)
);

-- ────────────────────────────────────────────────────────────
-- PRO WAITLIST
-- Simple email capture before Pro tier is built.
-- ────────────────────────────────────────────────────────────
create table pro_waitlist (
  id         uuid primary key default uuid_generate_v4(),
  email      text unique not null,
  user_id    uuid references auth.users(id),  -- null if not logged in
  created_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- HOMEPAGE CACHE
-- Stores ordered lists of book IDs for homepage sections
-- (NYT bestsellers, new releases) to avoid re-fetching daily.
-- ────────────────────────────────────────────────────────────
create table homepage_cache (
  id         uuid primary key default uuid_generate_v4(),
  cache_key  text unique not null,   -- e.g. 'nyt_bestseller_romance', 'romance_new_releases'
  book_ids   uuid[] not null,        -- ordered array of book IDs
  fetched_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

-- Books and tropes are public read
alter table books enable row level security;
create policy "Books are public" on books for select using (true);
create policy "Service role can write books" on books for all using (auth.role() = 'service_role');

alter table book_ratings enable row level security;
create policy "Ratings are public" on book_ratings for select using (true);
create policy "Service role can write ratings" on book_ratings for all using (auth.role() = 'service_role');

alter table book_spice enable row level security;
create policy "Spice is public" on book_spice for select using (true);
create policy "Service role can write spice" on book_spice for all using (auth.role() = 'service_role');

alter table tropes enable row level security;
create policy "Tropes are public" on tropes for select using (true);
create policy "Service role can write tropes" on tropes for all using (auth.role() = 'service_role');

alter table book_tropes enable row level security;
create policy "Book tropes are public" on book_tropes for select using (true);
create policy "Service role can write book tropes" on book_tropes for all using (auth.role() = 'service_role');

-- Profiles: public read, owner write
alter table profiles enable row level security;
create policy "Profiles are public" on profiles for select using (true);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = id);
create policy "Users can delete own profile" on profiles for delete using (auth.uid() = id);

-- Reading status: owner only
alter table reading_status enable row level security;
create policy "Users see own reading status" on reading_status for select using (auth.uid() = user_id);
create policy "Users manage own reading status" on reading_status for all using (auth.uid() = user_id);

-- User ratings: owner only (notes are private)
alter table user_ratings enable row level security;
create policy "Users see own ratings" on user_ratings for select using (auth.uid() = user_id);
create policy "Users manage own ratings" on user_ratings for all using (auth.uid() = user_id);

-- Hotlists: owner full access; public can read public lists
alter table hotlists enable row level security;
create policy "Owner sees all their hotlists" on hotlists for select using (auth.uid() = user_id);
create policy "Public lists are readable" on hotlists for select using (is_public = true);
create policy "Owner manages hotlists" on hotlists for all using (auth.uid() = user_id);

alter table hotlist_books enable row level security;
create policy "Hotlist books follow hotlist visibility" on hotlist_books for select
  using (
    exists (
      select 1 from hotlists h
      where h.id = hotlist_id
      and (h.user_id = auth.uid() or h.is_public = true)
    )
  );
create policy "Owner manages hotlist books" on hotlist_books for all
  using (
    exists (
      select 1 from hotlists h
      where h.id = hotlist_id and h.user_id = auth.uid()
    )
  );

-- Pro waitlist: owner only
alter table pro_waitlist enable row level security;
create policy "Users see own waitlist entry" on pro_waitlist for select using (auth.uid() = user_id);
create policy "Authenticated users can join waitlist" on pro_waitlist for insert with check (auth.uid() = user_id);
create policy "Users update own waitlist entry" on pro_waitlist for update using (auth.uid() = user_id);
create policy "Users delete own waitlist entry" on pro_waitlist for delete using (auth.uid() = user_id);

alter table homepage_cache enable row level security;
create policy "Homepage cache is public read" on homepage_cache for select using (true);
create policy "Service role can write homepage cache" on homepage_cache for all using (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- SEED DATA: Core tropes (from romance.io taxonomy)
-- ────────────────────────────────────────────────────────────
insert into tropes (slug, name, sort_order) values
  ('enemies-to-lovers',   'Enemies to Lovers',   1),
  ('slow-burn',           'Slow Burn',            2),
  ('forced-proximity',    'Forced Proximity',     3),
  ('second-chance',       'Second Chance',        4),
  ('fake-dating',         'Fake Dating',          5),
  ('grumpy-sunshine',     'Grumpy / Sunshine',    6),
  ('forbidden-romance',   'Forbidden Romance',    7),
  ('fae-faerie',          'Fae / Faerie',         8),
  ('chosen-one',          'Chosen One',           9),
  ('instalove',           'Insta-love',           10),
  ('age-gap',             'Age Gap',              11),
  ('reverse-harem',       'Reverse Harem',        12),
  ('arranged-marriage',   'Arranged Marriage',    13),
  ('bodyguard-romance',   'Bodyguard Romance',    14),
  ('sports-romance',      'Sports Romance',       15),
  ('small-town',          'Small Town',           16),
  ('billionaire',         'Billionaire',          17),
  ('dark-romance',        'Dark Romance',         18),
  ('vampire',             'Vampire',              19),
  ('shifter',             'Shifter',              20),
  ('mafia-romance',       'Mafia Romance',        21),
  ('office-romance',      'Office Romance',       22),
  ('holiday-romance',     'Holiday Romance',      23),
  ('friends-to-lovers',   'Friends to Lovers',   24),
  ('love-triangle',       'Love Triangle',        25);

-- ────────────────────────────────────────────────────────────
-- VIDEO GRABS (Grab from Video feature)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS video_grabs (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  url             text UNIQUE NOT NULL,
  platform        text,
  creator_handle  text,
  thumbnail_url   text,
  transcript      text,
  extracted_books jsonb,
  processed_at    timestamptz DEFAULT now(),
  user_id         uuid REFERENCES auth.users(id)
);

ALTER TABLE video_grabs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Video grabs are public" ON video_grabs FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create grabs" ON video_grabs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
