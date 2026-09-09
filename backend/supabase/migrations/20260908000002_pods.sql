-- Zenoho2 · T-004A · pods, membership, witness, reactions, invites, cycles
--
-- Schema only. No app code reads or writes any of this yet.
--
-- The governing constraint is D-005: a witness may see KEPT / MISSED / NO-DATA
-- and a streak, and nothing else. `daily_states` also carries deviation_min,
-- integrity, source_id and wear_presence, none of which a witness may ever see.
-- RLS cannot express that, because RLS grants or denies a whole ROW — so the
-- witness gets no policy on daily_states at all (a direct select returns zero
-- rows) and reads through a security-definer projection instead. See the block
-- above `witness_nights` for why that shape and not a view.
--
-- Idempotent: every object is created with `if not exists` or `or replace`, and
-- policies are dropped before creation, so re-running is a no-op (AC-4A.1).
--
-- Nothing in this file contains a project ref, a key, or anyone's data.

-- ============================================================================
-- Tables
-- ============================================================================

-- ------------------------------------------------------------------ pods ----
-- cycle_start_date + cycle_length_days express D-006. Rollover behaviour at day
-- 28 is deliberately absent: it needs a product decision and belongs to T-004B.
create table if not exists public.pods (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(trim(name)) between 1 and 60),
  created_by        uuid not null references public.users (id) on delete restrict,
  created_at        timestamptz not null default now(),
  cycle_start_date  date not null,
  cycle_length_days integer not null default 28 check (cycle_length_days between 1 and 365)
);

comment on table public.pods is
  'D-004. Pod size 3-8 is enforced by trigger on pod_members, not by the app.';

-- ----------------------------------------------------------- pod_members ----
-- witness_user_id is the ONE named witness for THIS member (D-005). It is not
-- symmetric: A witnessing B does not make B witness A.
--
-- Two rules on it are declarative rather than trigger-enforced, because a
-- constraint that the database understands cannot be forgotten:
--   * "must be a member of the same pod" — the composite self-reference
--     (pod_id, witness_user_id) -> (pod_id, user_id).
--   * "must not be the member themselves" — a check.
create table if not exists public.pod_members (
  pod_id          uuid not null references public.pods (id) on delete cascade,
  user_id         uuid not null references public.users (id) on delete cascade,
  joined_at       timestamptz not null default now(),
  status          text not null default 'active' check (status in ('active', 'left')),
  witness_user_id uuid,
  primary key (pod_id, user_id),
  constraint pod_members_witness_not_self check (witness_user_id is distinct from user_id),
  -- Column-scoped SET NULL (Postgres 15+; this project runs 17.6). Plain
  -- `on delete set null` would null BOTH referencing columns, and pod_id is
  -- NOT NULL — so removing a member who was someone's witness would error
  -- instead of simply clearing that person's witness slot.
  constraint pod_members_witness_in_pod
    foreign key (pod_id, witness_user_id)
    references public.pod_members (pod_id, user_id)
    on delete set null (witness_user_id)
);

create index if not exists idx_pod_members_user on public.pod_members (user_id);
create index if not exists idx_pod_members_witness on public.pod_members (pod_id, witness_user_id);

-- ------------------------------------------------------------- reactions ----
-- D-005: one reaction per day, from one person to one person, for one night.
-- The unique constraint is the enforcement — not application logic, which can be
-- raced by two taps or bypassed by a direct API call.
create table if not exists public.reactions (
  id           bigint generated always as identity primary key,
  from_user_id uuid not null references public.users (id) on delete cascade,
  to_user_id   uuid not null references public.users (id) on delete cascade,
  night_date   date not null,
  -- D-043: exactly ONE kind in v1. The thesis under test is that being witnessed
  -- changes behaviour; judgement stays out of the loop until that is measured.
  -- More kinds are a migration away, and adding one later is cheap. Shipping
  -- NUDGE and WELL_DONE now would have made the experiment unreadable, because a
  -- behaviour change could then be attributed to praise or to pressure rather
  -- than to being seen.
  kind         text not null default 'SEEN' check (kind = 'SEEN'),
  created_at   timestamptz not null default now(),
  constraint reactions_not_self check (from_user_id <> to_user_id),
  constraint reactions_one_per_day unique (from_user_id, to_user_id, night_date)
);

create index if not exists idx_reactions_to on public.reactions (to_user_id, night_date desc);

comment on constraint reactions_one_per_day on public.reactions is
  'D-005: exactly one reaction per (from, to, night). Enforced here, never in the app.';

-- ----------------------------------------------------------- pod_invites ----
-- Invite-only launch model. Delivery (email, links, deep links) is T-004B; this
-- table only records that an invite exists and whether it was used.
create table if not exists public.pod_invites (
  token       text primary key check (length(token) between 16 and 128),
  pod_id      uuid not null references public.pods (id) on delete cascade,
  created_by  uuid not null references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  accepted_by uuid references public.users (id) on delete set null,
  accepted_at timestamptz,
  constraint pod_invites_accepted_together
    check ((accepted_by is null) = (accepted_at is null))
);

create index if not exists idx_pod_invites_pod on public.pod_invites (pod_id);

-- ============================================================================
-- Pod size 3-8, enforced in the database (deliverable 1)
--
-- The upper bound is a hard trigger: a ninth ACTIVE member is refused.
--
-- The lower bound cannot be a constraint on membership, and saying so plainly
-- matters more than pretending otherwise: every pod passes through 1 and 2
-- members on its way to 3, so a check demanding >= 3 would make it impossible to
-- create one. The minimum is therefore a readiness rule, exposed as
-- `pod_is_ready()`, and the cycle must not start until it holds. T-004B enforces
-- that at the point a cycle starts; there is no earlier moment where it means
-- anything.
-- ============================================================================

create or replace function public.enforce_pod_size()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_count integer;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select count(*) into active_count
  from public.pod_members
  where pod_id = new.pod_id
    and status = 'active'
    and user_id <> new.user_id;   -- exclude self so an UPDATE cannot double-count

  if active_count >= 8 then
    raise exception 'pod % already has 8 active members', new.pod_id
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_pod_size on public.pod_members;
create trigger trg_pod_size
  before insert or update on public.pod_members
  for each row execute function public.enforce_pod_size();

create or replace function public.pod_is_ready(p_pod_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) between 3 and 8
  from public.pod_members
  where pod_id = p_pod_id and status = 'active'
$$;

-- ============================================================================
-- Membership helper
--
-- security definer, so a policy ON pod_members can ask "is the caller in this
-- pod?" without re-entering pod_members' own policy and recursing forever.
-- ============================================================================
create or replace function public.is_pod_member(p_pod_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pod_members
    where pod_id = p_pod_id and user_id = p_user_id and status = 'active'
  )
$$;

-- ============================================================================
-- Row-level security
--
-- Anon gets no policy on any table here, so an unauthenticated request reads
-- nothing (AC-4A.6). `force row level security` applies these to the owner too.
--
-- Note what is deliberately ABSENT: any witness policy on daily_states. A
-- witness's direct select on that table matches no policy and returns zero rows
-- (AC-4A.4). That is the whole mechanism for keeping deviation_min away from
-- them, and it is enforced by absence rather than by a rule that could be
-- written slightly wrong.
-- ============================================================================

alter table public.pods         enable row level security;
alter table public.pod_members  enable row level security;
alter table public.reactions    enable row level security;
alter table public.pod_invites  enable row level security;

alter table public.pods         force row level security;
alter table public.pod_members  force row level security;
alter table public.reactions    force row level security;
alter table public.pod_invites  force row level security;

-- pods -----------------------------------------------------------------------
drop policy if exists pods_select_member on public.pods;
create policy pods_select_member on public.pods
  for select to authenticated
  using (public.is_pod_member(id, (select auth.uid())));

drop policy if exists pods_insert_own on public.pods;
create policy pods_insert_own on public.pods
  for insert to authenticated
  with check (created_by = (select auth.uid()));

drop policy if exists pods_update_creator on public.pods;
create policy pods_update_creator on public.pods
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

-- pod_members ----------------------------------------------------------------
-- A member sees the roster of their own pod. That is the minimum the witness
-- feature needs: you must be able to see who is in the pod to name one of them.
-- It exposes membership, not nights.
drop policy if exists pod_members_select_same_pod on public.pod_members;
create policy pod_members_select_same_pod on public.pod_members
  for select to authenticated
  using (public.is_pod_member(pod_id, (select auth.uid())));

drop policy if exists pod_members_insert_self on public.pod_members;
create policy pod_members_insert_self on public.pod_members
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- A member edits only their OWN membership row — which is what naming a witness
-- is. Nobody can name a witness on someone else's behalf.
drop policy if exists pod_members_update_self on public.pod_members;
create policy pod_members_update_self on public.pod_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists pod_members_delete_self on public.pod_members;
create policy pod_members_delete_self on public.pod_members
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- reactions ------------------------------------------------------------------
-- Readable by either end: the sender needs to know they already reacted today,
-- the recipient needs to receive it.
drop policy if exists reactions_select_either_end on public.reactions;
create policy reactions_select_either_end on public.reactions
  for select to authenticated
  using (from_user_id = (select auth.uid()) or to_user_id = (select auth.uid()));

-- Only the NAMED WITNESS of the recipient may react to them (D-005). Being in
-- the same pod is not enough.
drop policy if exists reactions_insert_witness_only on public.reactions;
create policy reactions_insert_witness_only on public.reactions
  for insert to authenticated
  with check (
    from_user_id = (select auth.uid())
    and exists (
      select 1 from public.pod_members m
      where m.user_id = reactions.to_user_id
        and m.witness_user_id = (select auth.uid())
        and m.status = 'active'
    )
  );

-- No update policy: a reaction is a fact about a day, not a draft. The one-per-day
-- unique constraint would otherwise be trivially sidestepped by editing.

-- pod_invites ----------------------------------------------------------------
-- Creator-only for now. Redeeming an invite means reading a row you do not yet
-- have access to, which needs a security-definer accept function — that is
-- T-004B, and guessing at it here would be schema built around an unwritten flow.
drop policy if exists pod_invites_select_creator on public.pod_invites;
create policy pod_invites_select_creator on public.pod_invites
  for select to authenticated
  using (created_by = (select auth.uid()));

drop policy if exists pod_invites_insert_creator on public.pod_invites;
create policy pod_invites_insert_creator on public.pod_invites
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_pod_member(pod_id, (select auth.uid()))
  );

drop policy if exists pod_invites_delete_creator on public.pod_invites;
create policy pod_invites_delete_creator on public.pod_invites
  for delete to authenticated
  using (created_by = (select auth.uid()));

-- ============================================================================
-- The witness projection (deliverable 3, AC-4A.3)
--
-- Why a security-definer FUNCTION and not a view:
--
--   A view would need to read daily_states as someone permitted to read it. With
--   `force row level security` on that table, a view owned by the table owner is
--   still subject to its policies, so the view would return nothing; making it
--   work would mean either a BYPASSRLS owner or a witness SELECT policy on
--   daily_states. The second is exactly what must not exist — once a witness can
--   select the table, deviation_min is one `select *` away, and the protection
--   depends on every future query being careful.
--
--   The function inverts that. The witness has NO access to daily_states at all;
--   the only door is this function, and the function's return type is the
--   whitelist. A column added to daily_states tomorrow cannot appear here,
--   because the signature does not mention it. That is the same reasoning as
--   `toServerRow` on the device: construct the permitted shape, never redact the
--   forbidden one.
--
-- What it returns, and nothing else: night_date, state, streak.
--
-- `state` is narrowed to the three values D-005 permits. TRAVEL (D-016) is a real
-- state on the device but is not in the witness's vocabulary, so it is projected
-- as NO_DATA. That is the conservative reading — grant only what is listed —
-- and it is flagged in R-004A for the founder to confirm or overturn.
--
-- `streak` mirrors cycleStreak() in app/src/derive/index.ts exactly: KEPT
-- increments, MISSED resets to zero, NO_DATA and TRAVEL are neutral. Two
-- implementations of one rule is already one too many; if this ever disagrees
-- with the device, the device is right and this is the bug.
-- ============================================================================
create or replace function public.witness_nights(p_member uuid)
returns table (night_date date, state text, streak integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r           record;
  running     integer := 0;
  cycle_start date;
begin
  -- The caller must be the named witness of p_member, in an active membership.
  if not exists (
    select 1 from public.pod_members m
    where m.user_id = p_member
      and m.witness_user_id = auth.uid()
      and m.status = 'active'
  ) then
    return;   -- not a witness: zero rows, not an error. Nothing is disclosed.
  end if;

  -- D-006: the streak is a fact about the current cycle, not about all time.
  select p.cycle_start_date into cycle_start
  from public.pods p
  join public.pod_members m on m.pod_id = p.id
  where m.user_id = p_member and m.witness_user_id = auth.uid() and m.status = 'active'
  limit 1;

  for r in
    select d.night_date as nd, d.state as st
    from public.daily_states d
    join public.commitments c on c.id = d.commitment_id
    where c.user_id = p_member
      and (cycle_start is null or d.night_date >= cycle_start)
    order by d.night_date asc
  loop
    if r.st = 'KEPT' then
      running := running + 1;
    elsif r.st = 'MISSED' then
      running := 0;
    end if;   -- NO_DATA and TRAVEL are neutral, per cycleStreak()

    night_date := r.nd;
    state      := case when r.st in ('KEPT', 'MISSED') then r.st else 'NO_DATA' end;
    streak     := running;
    return next;
  end loop;
end $$;

revoke all on function public.witness_nights(uuid) from public, anon;
grant execute on function public.witness_nights(uuid) to authenticated;

revoke all on function public.pod_is_ready(uuid) from public, anon;
grant execute on function public.pod_is_ready(uuid) to authenticated;

revoke all on function public.is_pod_member(uuid, uuid) from public, anon;
grant execute on function public.is_pod_member(uuid, uuid) to authenticated;

-- enforce_pod_size runs as a trigger, never called directly.
revoke all on function public.enforce_pod_size() from public, anon, authenticated;
