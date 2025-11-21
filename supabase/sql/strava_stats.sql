-- Table storing Strava aggregated stats snapshots.
create table if not exists public.strava_stats (
  id bigint generated always as identity primary key,
  athlete_id bigint not null,
  generated_at timestamptz not null default now(),
  snapshot jsonb not null,
  source text not null default 'strava',
  created_at timestamptz not null default now()
);

create index if not exists strava_stats_athlete_created_idx
  on public.strava_stats (athlete_id, created_at desc);
