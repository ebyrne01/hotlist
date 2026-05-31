-- Refine paid enrichment focus to avoid broad contemporary spillover from
-- author/title keywords while keeping romantasy-adjacent canon books.

create or replace function public.get_p0_canon_enrichment_targets(
  p_limit integer default 250
)
returns table (
  book_id uuid,
  title text,
  author text,
  priority_score numeric,
  demand_score integer,
  recent_buzz_count integer,
  goodreads_rating_count integer
)
language sql
security definer
set search_path = public
as $$
  with demand as (
    select
      resolved_book_id as book_id,
      max(demand_score)::integer as demand_score
    from public.discovery_candidates
    where resolved_book_id is not null
      and status in ('new', 'resolved', 'enriched')
    group by resolved_book_id
  ),
  buzz as (
    select
      book_id,
      count(*)::integer as recent_buzz_count
    from public.book_buzz_signals
    where signal_date >= current_date - interval '30 days'
    group by book_id
  ),
  goodreads as (
    select
      book_id,
      max(coalesce(rating_count, 0))::integer as goodreads_rating_count
    from public.book_ratings
    where source = 'goodreads'
    group by book_id
  ),
  scored as (
    select
      b.id as book_id,
      b.title,
      b.author,
      coalesce(d.demand_score, 0) as demand_score,
      coalesce(z.recent_buzz_count, 0) as recent_buzz_count,
      coalesce(g.goodreads_rating_count, 0) as goodreads_rating_count,
      (
        coalesce(d.demand_score, 0) * 100000
        + coalesce(z.recent_buzz_count, 0) * 10000
        + least(coalesce(g.goodreads_rating_count, 0), 100000)
        + coalesce(b.quality_score, 0) * 1000
      )::numeric as priority_score
    from public.books b
    left join demand d on d.book_id = b.id
    left join buzz z on z.book_id = b.id
    left join goodreads g on g.book_id = b.id
    where b.is_canon = true
      and (
        coalesce(d.demand_score, 0) >= 100
        or coalesce(z.recent_buzz_count, 0) > 0
        or coalesce(g.goodreads_rating_count, 0) >= 5000
        or coalesce(b.quality_score, 0) >= 6
      )
      and not (
        lower(coalesce(b.author, '')) like any (array[
          '%danielle steel%',
          '%debbie macomber%',
          '%nora roberts%',
          '%nicholas sparks%',
          '%susan mallery%',
          '%robyn carr%',
          '%elin hilderbrand%',
          '%emily henry%',
          '%abby jimenez%',
          '%christina lauren%',
          '%jasmine guillory%',
          '%lynn painter%',
          '%ali hazelwood%',
          '%ana huang%',
          '%colleen hoover%',
          '%kristin hannah%',
          '%jennifer lynn barnes%'
        ])
      )
      and (
        b.subgenre in (
          'romantasy',
          'paranormal',
          'sci-fi-romance',
          'dark-romance',
          'erotic-romance'
        )
        or lower(array_to_string(coalesce(b.genres, array[]::text[]), ' ')) like any (array[
          '%fantasy%',
          '%paranormal%',
          '%vampire%',
          '%werewolf%',
          '%shifter%',
          '%witch%',
          '%fae%',
          '%faerie%',
          '%fairy%',
          '%dragon%',
          '%magic%',
          '%supernatural%',
          '%myth%',
          '%demon%',
          '%angel%',
          '%alien%',
          '%monster%',
          '%dystopian%'
        ])
        or lower(concat_ws(' ', b.title, b.author)) like any (array[
          '%romantasy%',
          '%fantasy romance%',
          '%romantic fantasy%',
          '%paranormal romance%',
          '%dark fantasy%',
          '%gothic romance%',
          '%vampire%',
          '%shifter%',
          '%witch%',
          '%fae%',
          '%faerie%',
          '%fairy%',
          '%dragon%',
          '%magic%',
          '%kingdom%',
          '%curse%',
          '%crown%',
          '%throne%',
          '%court%',
          '%blood%',
          '%bone%',
          '%immortal%',
          '%gods%',
          '%myth%',
          '%academy romance%',
          '%why choose%',
          '%reverse harem%',
          '%monster romance%',
          '%alien romance%',
          '%sci-fi romance%',
          '%scifi romance%',
          '%sarah j. maas%',
          '%sarah j maas%',
          '%rebecca yarros%',
          '%jennifer l. armentrout%',
          '%jennifer l armentrout%',
          '%carissa broadbent%',
          '%raven kennedy%',
          '%scarlett st. clair%',
          '%scarlett st clair%',
          '%laura thalassa%',
          '%holly black%',
          '%elise kova%',
          '%lj andrews%',
          '%l.j. andrews%',
          '%penn cole%',
          '%callie hart%',
          '%danielle l. jensen%',
          '%danielle l jensen%',
          '%lauren roberts%',
          '%kresley cole%',
          '%nalini singh%',
          '%ruby dixon%',
          '%katee robert%',
          '%h.d. carlton%',
          '%hd carlton%',
          '%rina kent%',
          '%bride ali hazelwood%',
          '%stephenie meyer%',
          '%tracy wolff%'
        ])
      )
  )
  select
    scored.book_id,
    scored.title,
    scored.author,
    scored.priority_score,
    scored.demand_score,
    scored.recent_buzz_count,
    scored.goodreads_rating_count
  from scored
  order by priority_score desc, goodreads_rating_count desc
  limit greatest(1, p_limit);
$$;

revoke all on function public.get_p0_canon_enrichment_targets(integer)
  from public, anon, authenticated;
grant execute on function public.get_p0_canon_enrichment_targets(integer)
  to service_role;
