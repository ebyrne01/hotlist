-- Keep the enrichment queue constraint aligned with the app's current JobType
-- union. Missing values here cause new-book resolution to create books but skip
-- queued enrichment work.

alter table public.enrichment_queue
  drop constraint if exists enrichment_queue_job_type_check;

alter table public.enrichment_queue
  add constraint enrichment_queue_job_type_check
  check (
    job_type = any (
      array[
        'goodreads_detail',
        'goodreads_rating',
        'amazon_rating',
        'romance_io_spice',
        'metadata',
        'ai_synopsis',
        'trope_inference',
        'review_classifier',
        'llm_spice',
        'author_crawl',
        'booktrack_prompt',
        'spotify_playlists',
        'ai_recommendations',
        'reddit_buzz',
        'discussion_links'
      ]::text[]
    )
  );
