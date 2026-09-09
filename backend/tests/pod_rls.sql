-- T-004A · pod, witness and reaction RLS, proven against a real instance.
--
-- Same shape as rls_denial.sql: real users, real policies, impersonation the way
-- PostgREST does it (`set local role authenticated` + request.jwt.claims), all
-- inside a transaction that is rolled back so it can be re-run indefinitely.
--
-- The cast:
--   W = witness           aaaaaaaa-...   named witness of M
--   M = member            bbbbbbbb-...   the person being witnessed
--   P = pod peer          cccccccc-...   in the same pod, NOT M's witness
--   O = outsider          dddddddd-...   in no pod at all
--
-- The claim under test is D-005: W sees night_date, state and streak for M, and
-- nothing else — not deviation_min, not integrity, not source_id, not
-- wear_presence, by any query path. P and O see nothing about M's nights at all.
--
-- Every "0 rows" assertion is preceded or accompanied by a positive control, so
-- a passing result means denial rather than an empty table.

begin;

create temp table pod_results (seq int, check_name text, result text) on commit drop;
grant insert, select on pod_results to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Seed as owner. force RLS applies to the owner too, so it is disabled for the
-- seed and re-enabled immediately.
-- ---------------------------------------------------------------------------
set local role postgres;

alter table public.users        disable row level security;
alter table public.commitments  disable row level security;
alter table public.daily_states disable row level security;
alter table public.pods         disable row level security;
alter table public.pod_members  disable row level security;
alter table public.reactions    disable row level security;
alter table public.pod_invites  disable row level security;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pod-w@example.invalid', '', now(), now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pod-m@example.invalid', '', now(), now(), now()),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pod-p@example.invalid', '', now(), now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pod-o@example.invalid', '', now(), now(), now())
on conflict (id) do nothing;

insert into public.users (id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd')
on conflict (id) do nothing;

insert into public.pods (id, name, created_by, cycle_start_date)
values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Test pod',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', date '2026-09-01')
on conflict (id) do nothing;

-- W and P first, so M's witness FK has a row to point at.
insert into public.pod_members (pod_id, user_id) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'cccccccc-cccc-cccc-cccc-cccccccccccc')
on conflict do nothing;

insert into public.pod_members (pod_id, user_id, witness_user_id) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
on conflict do nothing;

insert into public.commitments (id, user_id, bed_target_min, wake_target_min, tolerance_min)
overriding system value
values (900101, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1380, 420, 30)
on conflict (id) do nothing;

-- Four nights: KEPT, KEPT, MISSED, KEPT. Mirrors cycleStreak() — the running
-- streak should read 1, 2, 0, 1, so a projection that merely counted KEPT nights
-- would give 1, 2, 2, 3 and fail.
insert into public.daily_states
  (commitment_id, night_date, state, integrity, source_id, wear_presence, deviation_min, frozen)
values
  (900101, date '2026-09-03', 'KEPT',   'OK', 'com.garmin.android.apps.connectmobile', true,  8, false),
  (900101, date '2026-09-04', 'KEPT',   'OK', 'com.garmin.android.apps.connectmobile', true, 12, false),
  (900101, date '2026-09-05', 'MISSED', 'OK', 'com.garmin.android.apps.connectmobile', true, 74, false),
  (900101, date '2026-09-06', 'KEPT',   'OK', 'com.garmin.android.apps.connectmobile', true,  3, false)
on conflict (commitment_id, night_date) do nothing;

insert into public.pod_invites (token, pod_id, created_by, expires_at)
values ('seedtoken0123456', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() + interval '7 days')
on conflict (token) do nothing;

alter table public.users        enable row level security;
alter table public.commitments  enable row level security;
alter table public.daily_states enable row level security;
alter table public.pods         enable row level security;
alter table public.pod_members  enable row level security;
alter table public.reactions    enable row level security;
alter table public.pod_invites  enable row level security;

-- Positive control: the seed exists. Without this, every "0 rows" below could be
-- passing because the table is empty.
insert into pod_results
select 0, 'seed: 4 nights exist for M',
       case when count(*) = 4 then 'PASS: 4 nights seeded'
            else 'FAIL: ' || count(*) || ' nights' end
from public.daily_states where commitment_id = 900101;

-- ===========================================================================
-- W — the named witness
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

-- AC-4A.4 — the point of the whole design.
insert into pod_results
select 1, 'W direct select on M daily_states',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.daily_states where commitment_id = 900101;

insert into pod_results
select 2, 'W direct select on M commitments',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.commitments where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- The witness CAN read through the projection.
insert into pod_results
select 3, 'W reads M nights via witness_nights',
       case when count(*) = 4 then 'PASS: 4 nights' else 'FAIL: ' || count(*) || ' rows' end
from public.witness_nights('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- AC-4A.3 — the projection returns exactly three columns and no more.
insert into pod_results
select 4, 'witness_nights returns exactly night_date,state,streak',
       case when (select string_agg(a.attname, ',' order by a.attnum)
                  from pg_proc p
                  join unnest(p.proallargtypes, p.proargmodes, p.proargnames)
                       with ordinality as a(atttypid, attmode, attname, attnum)
                       on a.attmode = 't'
                  where p.oid = 'public.witness_nights(uuid)'::regprocedure)
                 = 'night_date,state,streak'
            then 'PASS: night_date,state,streak'
            else 'FAIL: ' || coalesce((select string_agg(a.attname, ',' order by a.attnum)
                  from pg_proc p
                  join unnest(p.proallargtypes, p.proargmodes, p.proargnames)
                       with ordinality as a(atttypid, attmode, attname, attnum)
                       on a.attmode = 't'
                  where p.oid = 'public.witness_nights(uuid)'::regprocedure), 'none') end;

-- The streak must match cycleStreak(): 1, 2, 0, 1.
insert into pod_results
select 5, 'streak mirrors cycleStreak (1,2,0,1)',
       case when string_agg(streak::text, ',' order by night_date) = '1,2,0,1'
            then 'PASS: 1,2,0,1'
            else 'FAIL: ' || string_agg(streak::text, ',' order by night_date) end
from public.witness_nights('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- W may react to M, once.
do $$
begin
  insert into public.reactions (from_user_id, to_user_id, night_date, kind)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          date '2026-09-06', 'SEEN');
  insert into pod_results values (6, 'W reacts to M once', 'PASS: accepted');
exception when others then
  insert into pod_results values (6, 'W reacts to M once', 'FAIL: refused (' || sqlstate || ')');
end $$;

-- AC-4A.5 — the second reaction is refused by the DATABASE, not by the app.
do $$
begin
  insert into public.reactions (from_user_id, to_user_id, night_date, kind)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          date '2026-09-06', 'SEEN');
  insert into pod_results values (7, 'W reacts twice on one night', 'FAIL: duplicate accepted');
exception
  when unique_violation then
    insert into pod_results values (7, 'W reacts twice on one night', 'PASS: unique constraint refused');
  when others then
    insert into pod_results values (7, 'W reacts twice on one night',
      'PASS: refused (' || sqlstate || ')');
end $$;

-- ===========================================================================
-- P — a pod peer who is NOT M's witness
-- ===========================================================================
set local request.jwt.claims =
  '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';

insert into pod_results
select 8, 'P direct select on M daily_states',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.daily_states where commitment_id = 900101;

-- The projection must refuse a non-witness even though P is in the same pod.
insert into pod_results
select 9, 'P reads M nights via witness_nights',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.witness_nights('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- P must not be able to react to M: being in the pod is not being the witness.
do $$
begin
  insert into public.reactions (from_user_id, to_user_id, night_date, kind)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          date '2026-09-05', 'SEEN');
  insert into pod_results values (10, 'P reacts to M', 'FAIL: accepted');
exception when others then
  insert into pod_results values (10, 'P reacts to M', 'PASS: refused (' || sqlstate || ')');
end $$;

-- P must not be able to make themselves M's witness.
update public.pod_members
set witness_user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- ===========================================================================
-- O — outside the pod entirely
-- ===========================================================================
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';

insert into pod_results
select 11, 'O selects the pod',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.pods where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

insert into pod_results
select 12, 'O selects pod_members',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.pod_members where pod_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

insert into pod_results
select 13, 'O reads M nights via witness_nights',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.witness_nights('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into pod_results
select 14, 'O selects pod_invites',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.pod_invites where pod_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

-- ===========================================================================
-- anon — AC-4A.6
-- ===========================================================================
set local role anon;

insert into pod_results
select 15, 'anon selects pods',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.pods;

insert into pod_results
select 16, 'anon selects pod_members',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.pod_members;

insert into pod_results
select 17, 'anon selects reactions',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.reactions;

insert into pod_results
select 18, 'anon selects pod_invites',
       case when count(*) = 0 then 'PASS: 0 rows' else 'FAIL: ' || count(*) || ' rows' end
from public.pod_invites;

do $$
begin
  perform public.witness_nights('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  insert into pod_results values (19, 'anon executes witness_nights', 'FAIL: execute allowed');
exception when insufficient_privilege then
  insert into pod_results values (19, 'anon executes witness_nights', 'PASS: execute revoked');
when others then
  insert into pod_results values (19, 'anon executes witness_nights',
    'PASS: refused (' || sqlstate || ')');
end $$;

-- ===========================================================================
-- Back to owner: structural checks and the ones needing unmediated reads.
-- ===========================================================================
set local role postgres;

-- P's attempt to hijack the witness slot must have changed nothing.
insert into pod_results
select 20, 'M witness unchanged by P update',
       case when (select witness_user_id from public.pod_members
                  where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
                 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
            then 'PASS: still W' else 'FAIL: P became the witness' end;

-- AC-4A.5 — the ninth active member. Five more join the existing three.
do $$
declare
  i integer;
  uid uuid;
begin
  for i in 1..5 loop
    uid := ('f0000000-0000-0000-0000-00000000000' || i)::uuid;
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'pod-f' || i || '@example.invalid', '', now(), now(), now())
    on conflict (id) do nothing;
    insert into public.users (id) values (uid) on conflict (id) do nothing;
    insert into public.pod_members (pod_id, user_id)
    values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', uid) on conflict do nothing;
  end loop;
  insert into pod_results values (21, 'pod fills to 8', 'PASS: 8 active members');
exception when others then
  insert into pod_results values (21, 'pod fills to 8', 'FAIL: ' || sqlerrm);
end $$;

insert into pod_results
select 22, 'pod has exactly 8 active members',
       case when count(*) = 8 then 'PASS: 8' else 'FAIL: ' || count(*) end
from public.pod_members
where pod_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' and status = 'active';

do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values ('f0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', 'pod-f9@example.invalid', '', now(), now(), now())
  on conflict (id) do nothing;
  insert into public.users (id) values ('f0000000-0000-0000-0000-000000000009')
  on conflict (id) do nothing;
  insert into public.pod_members (pod_id, user_id)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'f0000000-0000-0000-0000-000000000009');
  insert into pod_results values (23, 'ninth member rejected', 'FAIL: ninth member accepted');
exception when others then
  insert into pod_results values (23, 'ninth member rejected',
    'PASS: refused (' || sqlstate || ')');
end $$;

-- A witness must be in the same pod as the member (composite FK).
do $$
begin
  update public.pod_members
  set witness_user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
  where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  insert into pod_results values (24, 'witness from outside the pod', 'FAIL: accepted');
exception when others then
  insert into pod_results values (24, 'witness from outside the pod',
    'PASS: refused (' || sqlstate || ')');
end $$;

-- A member may not witness themselves.
do $$
begin
  update public.pod_members
  set witness_user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  insert into pod_results values (25, 'self as witness', 'FAIL: accepted');
exception when others then
  insert into pod_results values (25, 'self as witness', 'PASS: refused (' || sqlstate || ')');
end $$;

-- The projection's own column list must not include a forbidden one. Belt and
-- braces alongside check 4: this asserts the ABSENCE of each named column.
insert into pod_results
select 26, 'projection excludes deviation_min/integrity/source_id/wear_presence',
       case when (select count(*)
                  from unnest(array['deviation_min','integrity','source_id','wear_presence']) f
                  where f = any (
                    select unnest(p.proargnames) from pg_proc p
                    where p.oid = 'public.witness_nights(uuid)'::regprocedure)) = 0
            then 'PASS: none present' else 'FAIL: a forbidden column is projected' end;

-- D-043 must be a constraint, not a convention: any other kind is refused.
do $$
begin
  insert into public.reactions (from_user_id, to_user_id, night_date, kind)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          date '2026-09-04', 'WELL_DONE');
  insert into pod_results values (27, 'reaction kind other than SEEN', 'FAIL: accepted');
exception when others then
  insert into pod_results values (27, 'reaction kind other than SEEN',
    'PASS: refused (' || sqlstate || ')');
end $$;

select seq, check_name, result from pod_results order by seq;

rollback;
