-- Re-deploy merge_book_references with the current creator_book_mentions schema.
-- Production had an older function body that referenced creator_id on
-- creator_book_mentions; the table uses creator_handle_id.

create or replace function public.merge_book_references(
  source_id uuid,
  target_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if source_id is null or target_id is null or source_id = target_id then
    return;
  end if;

  delete from public.hotlist_books s
  where s.book_id = source_id
    and exists (
      select 1 from public.hotlist_books t
      where t.book_id = target_id
        and t.hotlist_id = s.hotlist_id
    );
  update public.hotlist_books set book_id = target_id where book_id = source_id;

  delete from public.user_ratings s
  where s.book_id = source_id
    and exists (
      select 1 from public.user_ratings t
      where t.book_id = target_id
        and t.user_id = s.user_id
    );
  update public.user_ratings set book_id = target_id where book_id = source_id;

  delete from public.reading_status s
  where s.book_id = source_id
    and exists (
      select 1 from public.reading_status t
      where t.book_id = target_id
        and t.user_id = s.user_id
    );
  update public.reading_status set book_id = target_id where book_id = source_id;

  delete from public.book_tropes s
  where s.book_id = source_id
    and exists (
      select 1 from public.book_tropes t
      where t.book_id = target_id
        and t.trope_id = s.trope_id
    );
  update public.book_tropes set book_id = target_id where book_id = source_id;

  delete from public.book_ratings s
  where s.book_id = source_id
    and exists (
      select 1 from public.book_ratings t
      where t.book_id = target_id
        and t.source = s.source
    );
  update public.book_ratings set book_id = target_id where book_id = source_id;

  delete from public.book_spice s
  where s.book_id = source_id
    and exists (
      select 1 from public.book_spice t
      where t.book_id = target_id
        and t.source = s.source
    );
  update public.book_spice set book_id = target_id where book_id = source_id;

  delete from public.spice_signals s
  where s.book_id = source_id
    and exists (
      select 1 from public.spice_signals t
      where t.book_id = target_id
        and t.source = s.source
    );
  update public.spice_signals set book_id = target_id where book_id = source_id;

  delete from public.enrichment_queue s
  where s.book_id = source_id
    and exists (
      select 1 from public.enrichment_queue t
      where t.book_id = target_id
        and t.job_type = s.job_type
    );
  update public.enrichment_queue set book_id = target_id where book_id = source_id;

  delete from public.book_recommendations s
  where s.book_id = source_id
    and exists (
      select 1 from public.book_recommendations t
      where t.book_id = target_id
        and t.recommended_book_id = s.recommended_book_id
    );
  update public.book_recommendations set book_id = target_id where book_id = source_id;

  delete from public.book_recommendations s
  where s.recommended_book_id = source_id
    and exists (
      select 1 from public.book_recommendations t
      where t.book_id = s.book_id
        and t.recommended_book_id = target_id
    );
  update public.book_recommendations
  set recommended_book_id = target_id
  where recommended_book_id = source_id;
  delete from public.book_recommendations where book_id = recommended_book_id;

  delete from public.creator_book_mentions s
  where s.book_id = source_id
    and exists (
      select 1 from public.creator_book_mentions t
      where t.book_id = target_id
        and t.creator_handle_id = s.creator_handle_id
        and t.video_grab_id is not distinct from s.video_grab_id
    );
  update public.creator_book_mentions set book_id = target_id where book_id = source_id;

  delete from public.book_buzz_signals s
  where s.book_id = source_id
    and exists (
      select 1 from public.book_buzz_signals t
      where t.book_id = target_id
        and t.source = s.source
        and t.signal_date = s.signal_date
    );
  update public.book_buzz_signals set book_id = target_id where book_id = source_id;

  delete from public.book_discussion_links s
  where s.book_id = source_id
    and exists (
      select 1 from public.book_discussion_links t
      where t.book_id = target_id
        and t.url = s.url
    );
  update public.book_discussion_links set book_id = target_id where book_id = source_id;
  update public.grab_feedback set book_id = target_id where book_id = source_id;

  delete from public.creator_share_cards s
  where s.book_id = source_id
    and exists (
      select 1 from public.creator_share_cards t
      where t.book_id = target_id
        and t.creator_id = s.creator_id
    );
  update public.creator_share_cards set book_id = target_id where book_id = source_id;

  delete from public.dnf_reasons s
  where s.book_id = source_id
    and exists (
      select 1 from public.dnf_reasons t
      where t.book_id = target_id
        and t.user_id = s.user_id
    );
  update public.dnf_reasons set book_id = target_id where book_id = source_id;

  delete from public.quality_flags s
  where s.book_id = source_id
    and s.status = 'open'
    and exists (
      select 1 from public.quality_flags t
      where t.book_id = target_id
        and t.status = 'open'
        and t.field_name = s.field_name
        and t.issue_type = s.issue_type
    );
  update public.quality_flags set book_id = target_id where book_id = source_id;
end;
$$;

revoke all on function public.merge_book_references(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.merge_book_references(uuid, uuid)
  to service_role;
