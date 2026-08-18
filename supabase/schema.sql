-- ============================================================
--  CampusMove — Supabase schema
--  Paste this whole file into: Supabase → SQL Editor → New query → Run
-- ============================================================

-- One row per bus currently on duty. Upserted every ~3s, never appended,
-- so the table stays tiny and reads stay instant.
create table if not exists live_positions (
  trip_id     text primary key,
  bus_name    text,
  route_id    text        not null,
  lat         double precision not null,
  lng         double precision not null,
  speed_kmh   real,
  heading     real,
  accuracy_m  real,
  occupancy   int,
  capacity    int default 45,
  d           double precision,          -- metres along the route
  updated_at  timestamptz not null default now()
);

-- "I'm waiting at this stop". Primary key stops one device double-counting.
create table if not exists tickets (
  id          text primary key,          -- '<stop_id>:<device_id>'
  stop_id     text not null,
  device_id   text not null,
  lat         double precision,
  lng         double precision,
  distance_m  real,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tickets_stop_idx on tickets (stop_id);

-- The campus definition published from the Map Builder.
create table if not exists campus (
  id          int primary key default 1,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  constraint campus_singleton check (id = 1)
);

-- ---------- housekeeping ----------
-- Buses that stopped reporting, and waiting requests nobody cancelled.
create or replace function prune_stale() returns void language sql as $$
  delete from live_positions where updated_at < now() - interval '3 minutes';
  delete from tickets        where created_at < now() - interval '15 minutes';
$$;

-- ---------- security ----------
-- Prototype policy: anyone may read, and write positions/tickets.
-- Good enough for a campus pilot; see SUPABASE.md for how to lock down
-- driver writes with auth before a wider rollout.
alter table live_positions enable row level security;
alter table tickets        enable row level security;
alter table campus         enable row level security;

drop policy if exists "public read positions"  on live_positions;
drop policy if exists "public write positions" on live_positions;
drop policy if exists "public read tickets"    on tickets;
drop policy if exists "public write tickets"   on tickets;
drop policy if exists "public read campus"     on campus;
drop policy if exists "public write campus"    on campus;

create policy "public read positions"  on live_positions for select using (true);
create policy "public write positions" on live_positions for all    using (true) with check (true);
create policy "public read tickets"    on tickets        for select using (true);
create policy "public write tickets"   on tickets        for all    using (true) with check (true);
create policy "public read campus"     on campus         for select using (true);
create policy "public write campus"    on campus         for all    using (true) with check (true);
