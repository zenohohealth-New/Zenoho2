-- Zenoho2 · T-003 · initial schema and row-level security
--
-- Spec §8 for shape, §7 for what the server is permitted to know, D-010 for why.
-- Migrations are the only way schema changes happen (T-003 constraint): nothing
-- here may be applied by hand in the dashboard.
--
-- Nothing in this file contains a project ref, a key, or anyone's data.

-- ---------------------------------------------------------------- users ----
-- One row per authenticated person. `id` mirrors auth.users so RLS can compare
-- against auth.uid() without a join.
create table if not exists public.users (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  tz           text,
  platform     text check (platform in ('android', 'ios')),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

comment on table public.users is
  'Spec §8. No email here: auth.users already holds it, and duplicating it widens the blast radius for nothing.';

-- ----------------------------------------------------------- commitments ----
-- pod_id is present but nullable so T-004 adds tables, not column rewrites.
create table if not exists public.commitments (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.users (id) on delete cascade,
  pod_id          uuid,
  cycle_no        integer,
  bed_target_min  integer not null check (bed_target_min between 0 and 1439),
  wake_target_min integer not null check (wake_target_min between 0 and 1439),
  tolerance_min   integer not null check (tolerance_min in (15, 30, 45, 60)),
  created_at      timestamptz not null default now()
);

create index if not exists idx_commitments_user on public.commitments (user_id);

-- ---------------------------------------------------------- daily_states ----
-- Spec §7 is the whole of what the server may hold about a night. There is
-- deliberately no room here for a sleep time, a heart rate, or an RHR value.
--
-- computed_at is set BY THE SERVER and never sent by the client (D-034): the
-- network guard's invariant is that no epoch-ms value and no ISO instant ever
-- crosses the wire, and that invariant is what makes AC-9 provable. The server's
-- clock is also the more trustworthy one — a client cannot misreport it.
--
-- device_clock_offset_min carries whole minutes of device-minus-server time, so
-- skew is measurable without a timestamp (D-034).
create table if not exists public.daily_states (
  id                      bigint generated always as identity primary key,
  commitment_id           bigint not null references public.commitments (id) on delete cascade,
  night_date              date not null,
  state                   text not null check (state in ('KEPT', 'MISSED', 'NO_DATA', 'TRAVEL')),
  integrity               text not null check (integrity in ('OK', 'UNVERIFIED', 'NO_SOURCE', 'NO_WEAR', 'TRAVEL')),
  source_id               text,
  wear_presence           boolean not null,
  deviation_min           integer,
  frozen                  boolean not null default false,
  device_clock_offset_min integer,
  computed_at             timestamptz not null default now(),
  unique (commitment_id, night_date)
);

create index if not exists idx_daily_states_night on public.daily_states (night_date desc);

comment on column public.daily_states.computed_at is
  'Server-set (D-034). The client never sends a timestamp.';
comment on column public.daily_states.device_clock_offset_min is
  'Whole minutes, device minus server, from a one-time probe (D-034).';

-- ----------------------------------------------------------- push_tokens ----
-- Spec §8. Unused in T-003 (notifications are local, spec §10) but created now so
-- the schema is complete and T-005 adds rows, not tables.
create table if not exists public.push_tokens (
  user_id    uuid not null references public.users (id) on delete cascade,
  token      text not null,
  platform   text not null check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  primary key (user_id, token)
);

-- ============================================================================
-- Row-level security
--
-- Spec §8: a user reads own rows only. The witness view arrives in T-004; until
-- then there is no cross-user read path at all, which is the easiest version of
-- this to prove (AC-3.3).
--
-- RLS is enabled with NO policy for the anon role anywhere, so an unauthenticated
-- request can read nothing (AC-3.9). `force row level security` additionally
-- applies these policies to the table owner, so a mistake in a future function
-- cannot quietly bypass them.
-- ============================================================================

alter table public.users        enable row level security;
alter table public.commitments  enable row level security;
alter table public.daily_states enable row level security;
alter table public.push_tokens  enable row level security;

alter table public.users        force row level security;
alter table public.commitments  force row level security;
alter table public.daily_states force row level security;
alter table public.push_tokens  force row level security;

-- users --------------------------------------------------------------------
create policy users_select_own on public.users
  for select to authenticated using (id = (select auth.uid()));

create policy users_insert_own on public.users
  for insert to authenticated with check (id = (select auth.uid()));

create policy users_update_own on public.users
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy users_delete_own on public.users
  for delete to authenticated using (id = (select auth.uid()));

-- commitments ---------------------------------------------------------------
create policy commitments_select_own on public.commitments
  for select to authenticated using (user_id = (select auth.uid()));

create policy commitments_insert_own on public.commitments
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy commitments_update_own on public.commitments
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy commitments_delete_own on public.commitments
  for delete to authenticated using (user_id = (select auth.uid()));

-- daily_states ---------------------------------------------------------------
-- Ownership is transitive through commitments; daily_states deliberately carries
-- no denormalised user_id, because spec §7 lists the columns the server may hold
-- and user_id is not one of them.
create policy daily_states_select_own on public.daily_states
  for select to authenticated
  using (exists (
    select 1 from public.commitments c
    where c.id = daily_states.commitment_id and c.user_id = (select auth.uid())
  ));

create policy daily_states_insert_own on public.daily_states
  for insert to authenticated
  with check (exists (
    select 1 from public.commitments c
    where c.id = daily_states.commitment_id and c.user_id = (select auth.uid())
  ));

create policy daily_states_update_own on public.daily_states
  for update to authenticated
  using (exists (
    select 1 from public.commitments c
    where c.id = daily_states.commitment_id and c.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.commitments c
    where c.id = daily_states.commitment_id and c.user_id = (select auth.uid())
  ));

create policy daily_states_delete_own on public.daily_states
  for delete to authenticated
  using (exists (
    select 1 from public.commitments c
    where c.id = daily_states.commitment_id and c.user_id = (select auth.uid())
  ));

-- push_tokens ----------------------------------------------------------------
create policy push_tokens_select_own on public.push_tokens
  for select to authenticated using (user_id = (select auth.uid()));

create policy push_tokens_insert_own on public.push_tokens
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy push_tokens_delete_own on public.push_tokens
  for delete to authenticated using (user_id = (select auth.uid()));

-- ============================================================================
-- Server time, for the D-034 clock-skew probe.
--
-- security invoker + a grant to authenticated only: an unauthenticated caller
-- learns nothing, not even the time.
-- ============================================================================
create or replace function public.server_now()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$ select now() $$;

revoke all on function public.server_now() from public, anon;
grant execute on function public.server_now() to authenticated;
