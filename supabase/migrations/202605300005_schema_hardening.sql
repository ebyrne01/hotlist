-- Harden helper RPC exposure and add indexes identified by the Supabase
-- database advisor. PostgreSQL grants PUBLIC execute on new functions unless
-- it is revoked explicitly, even when later grants target service_role only.

create index if not exists book_recommendations_recommended_book_idx
  on public.book_recommendations (recommended_book_id);
create index if not exists creator_applications_claim_handle_idx
  on public.creator_applications (claim_handle_id);
create index if not exists creator_book_mentions_video_grab_idx
  on public.creator_book_mentions (video_grab_id);
create index if not exists dnf_reasons_book_idx
  on public.dnf_reasons (book_id);
create index if not exists grab_feedback_user_idx
  on public.grab_feedback (user_id);
create index if not exists harvest_log_user_idx
  on public.harvest_log (user_id);
create index if not exists book_tropes_trope_idx
  on public.book_tropes (trope_id);
create index if not exists hotlist_books_book_idx
  on public.hotlist_books (book_id);
create index if not exists hotlists_user_idx
  on public.hotlists (user_id);
create index if not exists pro_waitlist_user_idx
  on public.pro_waitlist (user_id);
create index if not exists reading_status_book_idx
  on public.reading_status (book_id);
create index if not exists user_ratings_book_idx
  on public.user_ratings (book_id);
create index if not exists video_grabs_user_idx
  on public.video_grabs (user_id);

-- These lookups only need the caller's existing access to public book rows.
alter function public.fuzzy_book_search(text, integer) security invoker;

revoke all on function public.fuzzy_book_search(text, integer)
  from public;
grant execute on function public.fuzzy_book_search(text, integer)
  to anon, authenticated, service_role;

-- Aggregate follower counts are intentionally public. Keep this SECURITY
-- DEFINER so callers can see totals without being able to read follow rows.
revoke all on function public.count_followers_batch(uuid[])
  from public;
grant execute on function public.count_followers_batch(uuid[])
  to anon, authenticated, service_role;

-- Operational RPCs are server-only. Revoke the implicit PUBLIC execute grant
-- before granting the service role access.
revoke all on function public.search_books_fuzzy(text, integer)
  from public, anon, authenticated;
grant execute on function public.search_books_fuzzy(text, integer)
  to service_role;

revoke all on function public.get_top_tropes_for_user(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.get_top_tropes_for_user(uuid, integer)
  to service_role;

revoke all on function public.get_books_missing_amazon_rating()
  from public, anon, authenticated;
grant execute on function public.get_books_missing_amazon_rating()
  to service_role;

revoke all on function public.count_canon_with_recommendations()
  from public, anon, authenticated;
grant execute on function public.count_canon_with_recommendations()
  to service_role;

revoke all on function public.count_canon_with_source(text)
  from public, anon, authenticated;
grant execute on function public.count_canon_with_source(text)
  to service_role;

revoke all on function public.count_canon_with_spice_source(text)
  from public, anon, authenticated;
grant execute on function public.count_canon_with_spice_source(text)
  to service_role;

revoke all on function public.count_canon_with_tropes()
  from public, anon, authenticated;
grant execute on function public.count_canon_with_tropes()
  to service_role;
