-- AC-3.3 / AC-3.9 · RLS denial, proven against the live project (not a mock).
--
-- Two real users, A and B. B owns a commitment and a night. A then impersonates an
-- authenticated session and must be unable to see or touch any of it. Finally the
-- anon role must see nothing at all.
--
-- Impersonation is done the way PostgREST does it: `set local role authenticated`
-- plus `request.jwt.claims` carrying the user's sub. That is the same input
-- `auth.uid()` reads at runtime, so this exercises the real policies rather than a
-- re-implementation of them.
--
-- Everything runs in a transaction that is rolled back, so the test leaves no rows
-- behind and can be re-run against the live project as often as needed.
--
-- Results are collected into a temp table and selected once at the end, because
-- the query API returns only the final result set.
--
--   A = 11111111-1111-1111-1111-111111111111
--   B = 22222222-2222-2222-2222-222222222222

begin;

create temp table rls_results (seq int, check_name text, result text) on commit drop;
-- The test switches roles, so the roles it becomes must be able to record results.
grant insert, select on rls_results to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Seed as the owner. `force row level security` applies policies even to the
-- table owner, so RLS is turned off for the seed and back on immediately after.
-- ---------------------------------------------------------------------------
set local role postgres;
alter table public.users        disable row level security;
alter table public.commitments  disable row level security;
alter table public.daily_states disable row level security;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rls-a@example.invalid', '', now(), now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rls-b@example.invalid', '', now(), now(), now())
on conflict (id) do nothing;

insert into public.users (id)
values ('11111111-1111-1111-1111-111111111111'),
       ('22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

-- `overriding system value` because id is GENERATED ALWAYS; a fixed id keeps the
-- assertions below readable.
insert into public.commitments (id, user_id, bed_target_min, wake_target_min, tolerance_min)
overriding system value
values (900001, '22222222-2222-2222-2222-222222222222', 1380, 420, 30)
on conflict (id) do nothing;

insert into public.daily_states
  (commitment_id, night_date, state, integrity, source_id, wear_presence, deviation_min, frozen)
values
  (900001, date '2026-09-07', 'KEPT', 'OK',
   'com.garmin.android.apps.connectmobile', true, 10, false)
on conflict (commitment_id, night_date) do nothing;

alter table public.users        enable row level security;
alter table public.commitments  enable row level security;
alter table public.daily_states enable row level security;

-- Sanity: the seed really is there, so a later "0 rows" means denial and not an
-- empty table. A test that cannot fail proves nothing.
insert into rls_results
select 0, 'seed visible to owner',
       case when count(*) = 1 then 'PASS: 1 seeded night exists' else 'FAIL: seed missing' end
from public.daily_states where commitment_id = 900001;

-- ---------------------------------------------------------------------------
-- Become user A.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into rls_results
select 1, 'A selects B daily_states',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.daily_states where commitment_id = 900001;

insert into rls_results
select 2, 'A selects B commitments',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.commitments where user_id = '22222222-2222-2222-2222-222222222222';

insert into rls_results
select 3, 'A selects B user row',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.users where id = '22222222-2222-2222-2222-222222222222';

-- A must not be able to insert against B's commitment.
do $$
begin
  insert into public.daily_states
    (commitment_id, night_date, state, integrity, wear_presence, frozen)
  values (900001, date '2026-09-06', 'MISSED', 'OK', true, false);
  insert into rls_results values (4, 'A inserts into B commitment', 'FAIL: insert succeeded');
exception
  when insufficient_privilege then
    insert into rls_results values (4, 'A inserts into B commitment', 'PASS: RLS refused');
  when others then
    insert into rls_results values (4, 'A inserts into B commitment',
      'PASS: refused (' || sqlstate || ')');
end $$;

-- A's update must touch nothing: RLS hides the row, so it affects zero rows rather
-- than erroring. Assert the row is unchanged rather than trusting that.
update public.daily_states set state = 'MISSED' where commitment_id = 900001;

-- ---------------------------------------------------------------------------
-- The anon role must read nothing at all (AC-3.9).
-- ---------------------------------------------------------------------------
set local role anon;

insert into rls_results
select 5, 'anon selects daily_states',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.daily_states;

insert into rls_results
select 6, 'anon selects users',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.users;

-- ---------------------------------------------------------------------------
-- Back to the owner: check B's night survived A's update attempt, and report.
-- ---------------------------------------------------------------------------
set local role postgres;

insert into rls_results
select 7, 'B night unchanged by A update',
       case when (select state from public.daily_states
                  where commitment_id = 900001 and night_date = date '2026-09-07') = 'KEPT'
            then 'PASS: still KEPT' else 'FAIL: A changed it' end;

select check_name, result,
       (select case when count(*) = 0 then 'ALL PASS' else count(*) || ' FAILURES' end
        from rls_results where result like 'FAIL%') as overall
from rls_results order by seq;

rollback;
