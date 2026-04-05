-- ============================================================
-- USER CONTENT WARNING PREFERENCES
-- Run this in the Supabase SQL Editor.
-- ============================================================

create table user_cw_preferences (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  cw_category text not null,
  created_at  timestamptz default now(),
  unique(user_id, cw_category)
);

create index user_cw_preferences_user_idx on user_cw_preferences(user_id);

alter table user_cw_preferences enable row level security;

create policy "Users manage own CW prefs" on user_cw_preferences
  for all using (auth.uid() = user_id);

create policy "Service role full access on CW prefs" on user_cw_preferences
  for all using (auth.role() = 'service_role');
