/**
 * The morning trigger's pure time logic and its self-diagnosis.
 *
 * Context (R-002 §9, AC-2.7): on an S26 Ultra with battery set to "Optimised",
 * the 08:00 trigger fired at 08:05. Samsung batches inexact alarms, and a delay of
 * that order is expected platform behaviour. `judgeMorningSync` therefore has to
 * tolerate lateness without ever reporting a fire that did not happen.
 */
import { describe, expect, it } from 'vitest';
import {
  judgeMorningSync,
  MISSED_FIRE_GRACE_MIN,
  morningSyncMinute,
  MORNING_SYNC_OFFSET_MIN,
  nextDailyOccurrenceMs,
} from '../app/src/engine/morningSyncTime';

const IST = 330;
const DAY = 86_400_000;

describe('morningSyncMinute', () => {
  it('is wake target plus an hour', () => {
    expect(MORNING_SYNC_OFFSET_MIN).toBe(60);
    expect(morningSyncMinute(7 * 60)).toBe(8 * 60);
    expect(morningSyncMinute(6 * 60 + 30)).toBe(7 * 60 + 30);
  });

  it('wraps past midnight rather than overflowing', () => {
    expect(morningSyncMinute(23 * 60 + 30)).toBe(30); // 23:30 + 1h = 00:30
  });
});

describe('nextDailyOccurrenceMs', () => {
  it('picks today when the time is still ahead', () => {
    const now = Date.parse('2026-09-08T01:00:00Z'); // 06:30 IST
    const next = nextDailyOccurrenceMs(8 * 60, now, IST);
    expect(new Date(next).toISOString()).toBe('2026-09-08T02:30:00.000Z'); // 08:00 IST
  });

  it('rolls to tomorrow once the time has passed', () => {
    const now = Date.parse('2026-09-08T04:00:00Z'); // 09:30 IST, past 08:00
    const next = nextDailyOccurrenceMs(8 * 60, now, IST);
    expect(new Date(next).toISOString()).toBe('2026-09-09T02:30:00.000Z');
  });

  it('treats the exact instant as already gone, so it never schedules into the past', () => {
    const eight = Date.parse('2026-09-08T02:30:00Z');
    expect(nextDailyOccurrenceMs(8 * 60, eight, IST)).toBe(eight + DAY);
  });
});

describe('judgeMorningSync', () => {
  const NEXT = Date.parse('2026-09-09T02:30:00Z'); // tomorrow 08:00 IST
  const LAST_DUE = NEXT - DAY; // today 08:00 IST

  it('reports NEVER_SCHEDULED when nothing was ever armed', () => {
    expect(judgeMorningSync(null, null, Date.now()).state).toBe('NEVER_SCHEDULED');
  });

  it('reports FIRED when a fire was recorded at or after the last due time', () => {
    // The real observation: due 08:00, fired 08:05.
    const fired = LAST_DUE + 5 * 60_000;
    expect(judgeMorningSync(NEXT, fired, fired + 60_000).state).toBe('FIRED');
  });

  it('tolerates a long OEM delay without calling it a miss', () => {
    const late = LAST_DUE + (MISSED_FIRE_GRACE_MIN - 1) * 60_000;
    expect(judgeMorningSync(NEXT, null, late).state).toBe('PENDING');
  });

  it('reports MISSED once the grace window has passed with no fire', () => {
    const wellPast = LAST_DUE + (MISSED_FIRE_GRACE_MIN + 30) * 60_000;
    expect(judgeMorningSync(NEXT, null, wellPast).state).toBe('MISSED');
  });

  it('never reports FIRED from a stale fire recorded before the last due time', () => {
    // Yesterday's fire must not vouch for today's.
    const staleFire = LAST_DUE - 2 * 60_000;
    const wellPast = LAST_DUE + (MISSED_FIRE_GRACE_MIN + 30) * 60_000;
    expect(judgeMorningSync(NEXT, staleFire, wellPast).state).toBe('MISSED');
  });

  it('is PENDING before the due time even with no fire yet', () => {
    expect(judgeMorningSync(NEXT, null, LAST_DUE - 60 * 60_000).state).toBe('PENDING');
  });
});
