-- D-045 verification: the server accepts integrity = 'NO_HR', and still refuses
-- anything outside the ladder.
--
-- A real user, a real commitment and a real NO_HR night are inserted, then the
-- whole thing is rolled back — so the check runs against the live schema and
-- leaves nothing behind. Rollback rather than insert-then-delete on purpose: a
-- delete that is forgotten, or that fails halfway, leaves test rows in the
-- founder's own data.
--
-- Both directions are asserted. Showing that NO_HR is accepted proves nothing on
-- its own — a dropped constraint would accept it too, and would also accept
-- 'BANANA'. The negative control is what shows the constraint still exists.

begin;

create temp table nohr_results (seq int, check_name text, result text) on commit drop;

set local role postgres;

alter table public.users        disable row level security;
alter table public.commitments  disable row level security;
alter table public.daily_states disable row level security;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('9a9a9a9a-9a9a-9a9a-9a9a-9a9a9a9a9a9a',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'nohr@example.invalid', '', now(), now(), now())
on conflict (id) do nothing;

insert into public.users (id) values ('9a9a9a9a-9a9a-9a9a-9a9a-9a9a9a9a9a9a')
on conflict (id) do nothing;

insert into public.commitments (id, user_id, bed_target_min, wake_target_min, tolerance_min)
overriding system value
values (900901, '9a9a9a9a-9a9a-9a9a-9a9a-9a9a9a9a9a9a', 1380, 420, 30)
on conflict (id) do nothing;

-- The row the app now produces: sleep arrived, its own source sent no heart rate.
-- deviation_min is null and wear_presence false, exactly as `noDataResult` builds it.
do $$
begin
  insert into public.daily_states
    (commitment_id, night_date, state, integrity, source_id, wear_presence, deviation_min, frozen)
  values (900901, date '2026-09-13', 'NO_DATA', 'NO_HR',
          'com.sec.android.app.shealth', false, null, false);
  insert into nohr_results values (1, 'insert integrity = NO_HR', 'PASS: accepted');
exception when others then
  insert into nohr_results values (1, 'insert integrity = NO_HR',
    'FAIL: refused (' || sqlstate || ') ' || sqlerrm);
end $$;

insert into nohr_results
select 2, 'the NO_HR row reads back intact',
       case when count(*) = 1 then 'PASS: 1 row, state NO_DATA, deviation_min null'
            else 'FAIL: ' || count(*) || ' rows' end
from public.daily_states
where commitment_id = 900901
  and night_date = date '2026-09-13'
  and integrity = 'NO_HR'
  and state = 'NO_DATA'
  and deviation_min is null;

-- Negative control: the constraint must still be a constraint.
do $$
begin
  insert into public.daily_states
    (commitment_id, night_date, state, integrity, wear_presence, frozen)
  values (900901, date '2026-09-12', 'NO_DATA', 'BANANA', false, false);
  insert into nohr_results values (3, 'a value outside the ladder', 'FAIL: accepted');
exception when check_violation then
  insert into nohr_results values (3, 'a value outside the ladder', 'PASS: check refused');
when others then
  insert into nohr_results values (3, 'a value outside the ladder',
    'PASS: refused (' || sqlstate || ')');
end $$;

-- And every value the ladder does list must still be accepted.
do $$
declare v text;
begin
  foreach v in array array['OK','UNVERIFIED','NO_SOURCE','NO_WEAR','TRAVEL'] loop
    insert into public.daily_states
      (commitment_id, night_date, state, integrity, wear_presence, frozen)
    values (900901, date '2026-09-01' + (array_position(
              array['OK','UNVERIFIED','NO_SOURCE','NO_WEAR','TRAVEL'], v)),
            'NO_DATA', v, false, false);
  end loop;
  insert into nohr_results values (4, 'the five pre-existing values still accepted', 'PASS: all 5');
exception when others then
  insert into nohr_results values (4, 'the five pre-existing values still accepted',
    'FAIL: ' || sqlerrm);
end $$;

alter table public.users        enable row level security;
alter table public.commitments  enable row level security;
alter table public.daily_states enable row level security;

select seq, check_name, result from nohr_results order by seq;

rollback;
