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
  readonly state: 'NEVER_SCHEDULED' | 'PENDING' | 'FIRED' | 'MISSED';
  readonly detail: string;
}

/**
 * Decide, from stored bookkeeping alone, whether the last expected trigger fired.
 * Deliberately conservative: it never reports FIRED without a recorded fire.
 */
export function judgeMorningSync(
  nextAtMs: number | null,
  lastFiredMs: number | null,
  nowMs: number,
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
  return {
    state: 'MISSED',
    detail: 'the expected time passed with no trigger recorded',
  };
}
