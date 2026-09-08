/**
 * Pure time arithmetic for the morning trigger, kept apart from
 * `morningSync.ts` so it can be tested in Node without the native module.
 */

export const MORNING_SYNC_OFFSET_MIN = 60;

/** wake_target + 60 min, wrapped into the next day if it runs past midnight. */
export function morningSyncMinute(wakeTargetMin: number): number {
  return (((wakeTargetMin + MORNING_SYNC_OFFSET_MIN) % 1440) + 1440) % 1440;
}

/**
 * The next wall-clock instant at `minuteOfDay` local, at or after `nowMs`.
 *
 * Used to record what the app *believes* is scheduled, so a morning that produced
 * no notification can be told apart from one where nothing was ever scheduled.
 */
export function nextDailyOccurrenceMs(
  minuteOfDay: number,
  nowMs: number,
  tzOffsetMin: number,
): number {
  const MIN_MS = 60_000;
  const localNow = nowMs + tzOffsetMin * MIN_MS;
  const localMidnight = Math.floor(localNow / 86_400_000) * 86_400_000;
  let localTarget = localMidnight + minuteOfDay * MIN_MS;
  if (localTarget <= localNow) localTarget += 86_400_000;
  return localTarget - tzOffsetMin * MIN_MS;
}

/**
 * How a scheduled-but-silent morning is judged: if the expected fire time has
 * passed by more than this and nothing was recorded, the trigger did not fire.
 * Generous, because Android may defer an inexact alarm by a long way.
 */
export const MISSED_FIRE_GRACE_MIN = 120;

export interface MorningSyncVerdict {
  readonly state:
    | 'NEVER_SCHEDULED'
    | 'NOT_YET_OBSERVED'
    | 'PENDING'
    | 'FIRED'
    | 'MISSED';
  readonly detail: string;
}

/**
 * Decide, from stored bookkeeping alone, whether the last expected trigger fired.
 *
 * Conservative in both directions. It never reports FIRED without a recorded
 * fire — and, just as importantly, it never reports MISSED for an occurrence the
 * bookkeeping could not have seen.
 *
 * That second rule exists because of a real false alarm: the morning trigger fired
 * at 08:05 on 2026-09-08, but `app_kv` (migration 3) was created later that day, so
 * no record of the fire could exist. The screen accused the OS of dropping a
 * notification that had actually arrived. A verdict that can be wrong in the
 * alarming direction is worse than one that admits it does not know yet.
 *
 * `lastScheduledMs` is when the schedule was last recorded. If that is *after* the
 * occurrence being judged, the fire happened before this device was keeping notes.
 */
export function judgeMorningSync(
  nextAtMs: number | null,
  lastFiredMs: number | null,
  nowMs: number,
  lastScheduledMs: number | null = null,
): MorningSyncVerdict {
  if (nextAtMs === null) {
    return { state: 'NEVER_SCHEDULED', detail: 'no trigger has been scheduled' };
  }

  // The occurrence we most recently expected to fire.
  const previousOccurrence = nextAtMs - 86_400_000;

  if (lastFiredMs !== null && lastFiredMs >= previousOccurrence) {
    return { state: 'FIRED', detail: 'fired at the last expected time' };
  }
  if (nowMs < previousOccurrence + MISSED_FIRE_GRACE_MIN * 60_000) {
    return { state: 'PENDING', detail: 'not yet due, or inside the grace window' };
  }
  if (lastScheduledMs === null || lastScheduledMs > previousOccurrence) {
    return {
      state: 'NOT_YET_OBSERVED',
      detail: 'scheduling was recorded after the last due time, so nothing could be observed',
    };
  }
  return {
    state: 'MISSED',
    detail: 'the expected time passed with no trigger recorded',
  };
}
