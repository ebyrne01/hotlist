-- ============================================================
-- READING DNA — Preference Engine Tables
-- Run this in the Supabase SQL Editor after the main schema.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- READING DNA
-- One row per user. Stores computed trope affinities and
-- spice preference derived from all signal sources (quiz,
-- imports, ratings, scans).
-- ────────────────────────────────────────────────────────────
create table reading_dna (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid unique not null references auth.users(id) on delete cascade,
  trope_affinities jsonb not null default '{}',  -- {"enemies-to-lovers": 0.92, ...}
  spice_preferred  numeric(2,1) default 3.0,     -- 1.0–5.0
  spice_tolerance  numeric(2,1) default 1.0,     -- std dev of preference
  source          text not null default 'quiz'
    check (source in ('quiz', 'import', 'scan', 'organic')),
  signal_count    integer not null default 0,
  dna_description text,                         -- AI-generated reading personality blurb
  last_computed_at timestamptz default now(),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index reading_dna_user_idx on reading_dna(user_id);

-- ────────────────────────────────────────────────────────────
-- READING DNA SIGNALS
-- Raw signal log — every book the user interacted with and how.
-- Enables full recomputation of DNA at any time.
-- ────────────────────────────────────────────────────────────
create table reading_dna_signals (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  book_id     uuid not null references books(id) on delete cascade,
  signal_type text not null
    check (signal_type in ('quiz_pick', 'rating', 'gr_import', 'sg_import', 'kindle_import', 'scan', 'reading_status')),
  weight      numeric(3,2) not null default 0.5
    check (weight >= 0.0 and weight <= 1.0),
  created_at  timestamptz default now(),
  unique(user_id, book_id, signal_type)
);

create index reading_dna_signals_user_idx on reading_dna_signals(user_id);

-- ────────────────────────────────────────────────────────────
-- BOOK TROPE VECTORS
-- Precomputed trope vector per book for fast dot-product scoring.
-- Binary for now: has trope = 1.0, absent = not in JSONB.
-- ────────────────────────────────────────────────────────────
create table book_trope_vectors (
  book_id uuid primary key references books(id) on delete cascade,
  vector  jsonb not null default '{}',  -- {"enemies-to-lovers": 1.0, "slow-burn": 1.0}
  updated_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

-- Reading DNA: owner read/write, service role full access
alter table reading_dna enable row level security;
create policy "Users see own DNA" on reading_dna
  for select using (auth.uid() = user_id);
create policy "Users manage own DNA" on reading_dna
  for all using (auth.uid() = user_id);
create policy "Service role can manage DNA" on reading_dna
  for all using (auth.role() = 'service_role');

-- Signals: owner read/write, service role full access
alter table reading_dna_signals enable row level security;
create policy "Users see own signals" on reading_dna_signals
  for select using (auth.uid() = user_id);
create policy "Users manage own signals" on reading_dna_signals
  for all using (auth.uid() = user_id);
create policy "Service role can manage signals" on reading_dna_signals
  for all using (auth.role() = 'service_role');

-- Book trope vectors: public read, service role write
alter table book_trope_vectors enable row level security;
create policy "Trope vectors are public" on book_trope_vectors
  for select using (true);
create policy "Service role can write trope vectors" on book_trope_vectors
  for all using (auth.role() = 'service_role');
