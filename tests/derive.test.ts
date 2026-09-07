/**
 * AC-2: every case in tests/fixtures/derivation-cases.json, plus unit coverage
 * of the §5 helpers the fixtures cannot reach directly.
 */
import { describe, expect, it } from 'vitest';
import {
  applyRevision,
  circularDiffMin,
  cycleStreak,
  deriveDailyState,
  freezeAtMs,
  localMinuteOfDay,
  parseHhMm,
  roundTo5,
  shouldPromptDeviceCheck,
  wearPresence,
} from '../app/src/derive';
import { rhrCoherence } from '../app/src/derive/rhr';
import { selectMainSession } from '../app/src/derive/session';
import type { HrSample } from '../app/src/derive/types';
import { deriveCases, revisionCases } from './helpers/fixtures';

const COMPUTED_AT = Date.parse('2026-09-07T04:00:00Z');

describe('deriveDailyState — fixture cases', () => {
  it('the fixture file actually covers AC-2 and then some', () => {
    const ids = [...deriveCases, ...revisionCases].map((c) => c.id);
    // AC-2 names eight behaviours; late sync splits into a before/after pair.
    expect(ids.filter((i) => i.startsWith('AC2-')).length).toBe(9);
    // The task asks for at least five cases beyond AC-2.
    expect(ids.filter((i) => i.startsWith('EXTRA-')).length).toBeGreaterThanOrEqual(5);
  });

  for (const c of deriveCases) {
    it(`${c.id} — ${c.description}`, () => {
      const result = deriveDailyState(
        {
          nightDate: c.nightDate,
          commitment: c.commitment,
          sessions: c.sessions,
          hr: c.hr,
          tzOffsetMin: c.tzOffsetMin,
          prevTzOffsetMin: c.prevTzOffsetMin,
          rhrHistory: c.rhrHistory,
        },
        c.platform,
        COMPUTED_AT,
      );

      expect(result.night.state).toBe(c.expected.state);
      expect(result.night.integrity).toBe(c.expected.integrity);
      expect(result.night.wearPresence).toBe(c.expected.wearPresence);
      expect(result.night.deviationMin).toBe(c.expected.deviationMin);
      expect(result.night.sourceId).toBe(c.expected.sourceId);
    });
  }
});

describe('applyRevision — fixture cases', () => {
  for (const c of revisionCases) {
    it(`${c.id} — ${c.description}`, () => {
      const kept = applyRevision(c.existing, c.fresh, c.nowMs, c.tzOffsetMin);
      expect(kept.state).toBe(c.expected.state);
      expect(kept.integrity).toBe(c.expected.integrity);
      expect(kept.frozen).toBe(c.expected.frozen);
      expect(kept.revisionCount).toBe(c.expected.revisionCount);
    });
  }

  it('a past night is frozen regardless of the current time of day', () => {
    // Regression: freezing used to key off now's time-of-day only, so a night from
    // last week was revisable every morning and frozen every afternoon. Backfill
    // (T-002) is made entirely of past nights, so this had to be night-anchored.
    const old = { ...revisionCases[0].existing, nightDate: '2026-08-20' };
    const kept = applyRevision(
      old,
      { ...revisionCases[0].fresh, nightDate: '2026-08-20' },
      Date.parse('2026-09-07T03:30:00Z'), // 09:00 IST today, well before 14:00
      330,
    );
    expect(kept.state).toBe(old.state);
    expect(kept.frozen).toBe(true);
  });

  it('freezeAtMs lands on 14:00 local of the night date', () => {
    // 14:00 IST on 2026-09-07 is 08:30Z.
    expect(freezeAtMs('2026-09-07', 330)).toBe(Date.parse('2026-09-07T08:30:00Z'));
  });

  it('a frozen row is never replaced, even before 14:00', () => {
    const frozen = { ...revisionCases[0].existing, frozen: true };
    const kept = applyRevision(
      frozen,
      revisionCases[0].fresh,
      Date.parse('2026-09-07T03:30:00Z'),
      330,
    );
    expect(kept.state).toBe(frozen.state);
    expect(kept.frozen).toBe(true);
  });
});

describe('§5 helpers', () => {
  it('circularDiffMin does not wrap around midnight', () => {
    expect(circularDiffMin(10, 1430)).toBe(20); // 00:10 vs 23:50
    expect(circularDiffMin(1430, 10)).toBe(-20);
    expect(circularDiffMin(0, 0)).toBe(0);
  });

  it('localMinuteOfDay applies the offset', () => {
    // 2026-09-06T17:40Z is 23:10 in IST.
    expect(localMinuteOfDay(Date.parse('2026-09-06T17:40:00Z'), 330)).toBe(23 * 60 + 10);
  });

  it('roundTo5 rounds to the nearest five', () => {
    expect(roundTo5(63)).toBe(65);
    expect(roundTo5(62)).toBe(60);
    expect(roundTo5(0)).toBe(0);
  });

  it('parseHhMm rejects malformed input rather than guessing', () => {
    expect(parseHhMm('23:00')).toBe(1380);
    expect(() => parseHhMm('25:00')).toThrow();
    expect(() => parseHhMm('7:00')).toThrow();
  });

  it('wearPresence counts a trailing partial bucket', () => {
    const start = Date.parse('2026-09-07T00:00:00Z');
    const end = start + 70 * 60_000; // 70 min -> 3 buckets (30 + 30 + 10)
    const hr: HrSample[] = [
      { sourceId: 'x', atMs: start + 5 * 60_000, bpm: 60, recordingMethod: 'AUTOMATIC' },
      { sourceId: 'x', atMs: start + 35 * 60_000, bpm: 60, recordingMethod: 'AUTOMATIC' },
    ];
    const w = wearPresence(hr, start, end);
    expect(w.bucketsTotal).toBe(3);
    expect(w.bucketsCovered).toBe(2);
    expect(w.present).toBe(false); // 0.667 < 0.70
  });

  it('D-019: wearPresence drops samples the source filter rejects', () => {
    const start = Date.parse('2026-09-07T00:00:00Z');
    const end = start + 60 * 60_000; // 2 buckets
    const hr: HrSample[] = [
      { sourceId: 'com.phone.os', atMs: start + 5 * 60_000, bpm: 60, recordingMethod: 'AUTOMATIC' },
      { sourceId: 'com.phone.os', atMs: start + 35 * 60_000, bpm: 60, recordingMethod: 'AUTOMATIC' },
    ];
    const w = wearPresence(hr, start, end, (s) => s.sourceId !== 'com.phone.os');
    expect(w.bucketsCovered).toBe(0);
    expect(w.samplesRejected).toBe(2);
    expect(w.present).toBe(false);
  });

  it('cycleStreak counts KEPT, resets on MISSED, ignores NO_DATA and TRAVEL', () => {
    expect(cycleStreak(['KEPT', 'KEPT', 'NO_DATA', 'KEPT'])).toBe(3);
    expect(cycleStreak(['KEPT', 'KEPT', 'MISSED', 'KEPT'])).toBe(1);
    expect(cycleStreak(['KEPT', 'TRAVEL', 'KEPT'])).toBe(2);
    expect(cycleStreak([])).toBe(0);
  });

  it('three consecutive NO_DATA nights prompt a device check', () => {
    expect(shouldPromptDeviceCheck(['NO_DATA', 'NO_DATA', 'NO_DATA'])).toBe(true);
    expect(shouldPromptDeviceCheck(['NO_DATA', 'KEPT', 'NO_DATA'])).toBe(false);
    expect(shouldPromptDeviceCheck(['NO_DATA', 'NO_DATA'])).toBe(false);
  });

  it('rhrCoherence stays silent below 14 baseline nights', () => {
    const history = Array.from({ length: 13 }, (_, i) => ({
      nightDate: `2026-08-${String(i + 1).padStart(2, '0')}`,
      restingBpm: i < 6 ? 80 : 50,
    }));
    expect(rhrCoherence(history, '2026-09-07').evaluated).toBe(false);
  });

  it('selectMainSession prefers a shorter wearable session over a longer manual one', () => {
    const wearable = {
      sourceId: 'com.garmin.android.apps.connectmobile',
      startMs: Date.parse('2026-09-06T17:40:00Z'),
      endMs: Date.parse('2026-09-07T01:05:00Z'),
      recordingMethod: 'AUTOMATIC' as const,
    };
    const longerManual = {
      sourceId: 'com.garmin.android.apps.connectmobile',
      startMs: Date.parse('2026-09-06T16:00:00Z'),
      endMs: Date.parse('2026-09-07T02:00:00Z'),
      recordingMethod: 'MANUAL' as const,
    };
    const pick = selectMainSession([longerManual, wearable], '2026-09-07', 330, 'android');
    expect(pick?.session.startMs).toBe(wearable.startMs);
  });
});
