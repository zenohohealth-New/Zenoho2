-- Zenoho2 · T-005 · allow integrity = 'NO_HR' (D-045)
--
-- DEF-005-01 split one integrity reason into two. "Sleep arrived but its own
-- source supplied no heart rate" used to be reported as NO_WEAR, which was
-- misleading — nothing was worn, so there was no wear ratio to be below a
-- threshold — and it was indistinguishable from a watch that was worn badly.
-- D-045 gives it its own value, NO_HR.
--
-- **This migration is not optional.** `daily_states.integrity` carries a CHECK
-- constraint listing the permitted values, and the app now produces a value that
-- is not in it. Until this runs, every NO_HR night is refused by PostgREST with
-- a 400 and stays queued forever — the sync retries on each foreground and
-- fails identically every time, with nothing on screen to explain why.
--
-- Idempotent: the constraint is dropped by name and recreated, so re-running is
-- a no-op. `if exists` covers a database that never had it.
--
-- Nothing here contains a project ref, a key, or anyone's data.

alter table public.daily_states
  drop constraint if exists daily_states_integrity_check;

alter table public.daily_states
  add constraint daily_states_integrity_check
  check (integrity in ('OK', 'UNVERIFIED', 'NO_SOURCE', 'NO_HR', 'NO_WEAR', 'TRAVEL'));

comment on column public.daily_states.integrity is
  'Spec §7 plus NO_HR (D-045): sleep recorded, but its own source sent no heart rate across it.';
