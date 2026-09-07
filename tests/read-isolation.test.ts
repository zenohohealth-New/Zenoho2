/**
 * Regression for the S26 Ultra failure of 2026-09-07.
 *
 * A missing `READ_RESTING_HEART_RATE` permission made the RestingHeartRate read
 * throw a SecurityException, which propagated out of the probe and blanked every
 * row on the harness — sleep and heart rate had both read fine. Reads must be
 * isolated: one failure may cost its own data and nothing else, and an RHR
 * failure must degrade to the D-017 fallback rather than throw.
 */
import { describe, expect, it, vi } from 'vitest';
import type { RhrNight } from '../app/src/derive/types';
import type { HealthStore } from '../app/src/health/types';
import { loadRhrHistory } from '../app/src/health/rhrHistory';
import { InMemoryRhrHistoryStore } from '../app/src/storage/rhrStore';
import {
  readNightRecords,
  readRhrRecords,
  type ReadRecordsFn,
} from '../app/src/health/healthConnectMapping';

const START = Date.parse('2026-09-06T17:40:00Z');
const END = Date.parse('2026-09-07T01:05:00Z');

const SECURITY_EXCEPTION =
  'android.health.connect.HealthConnectException: java.lang.SecurityException: ' +
  'Caller requires android.permission.health.READ_RESTING_HEART_RATE to read record ' +
  'type class android.health.connect.datatypes.RestingHeartRateRecord';

function hrSamples(count: number, bpm = 58) {
  return Array.from({ length: count }, (_, i) => ({
    sourceId: 'com.garmin.android.apps.connectmobile',
    atMs: START + i * 60_000,
    bpm: bpm + (i % 5),
    recordingMethod: 'AUTOMATIC' as const,
  }));
}

/** A store whose RHR read throws exactly the way the real device did. */
function storeWithThrowingRhr(): HealthStore {
  return {
    platform: 'android',
    isAvailable: vi.fn(async () => true),
    requestReadPermissions: vi.fn(async () => 'GRANTED' as const),
    hasBackgroundAccess: vi.fn(async () => true),
    readNight: vi.fn(async () => ({ sessions: [], hr: [], readErrors: [] })),
    readRhrHistory: vi.fn(async () => {
      throw new Error(SECURITY_EXCEPTION);
    }),
  };
}

describe('RHR read failure degrades instead of propagating', () => {
  it('does not throw when the store rejects the RHR read', async () => {
    const local = new InMemoryRhrHistoryStore();
    await expect(
      loadRhrHistory(
        storeWithThrowingRhr(),
        local,
        '2026-09-07',
        330,
        hrSamples(20),
        START,
        END,
      ),
    ).resolves.toBeDefined();
  });

  it('falls back to the on-device percentile and reports the store error', async () => {
    const local = new InMemoryRhrHistoryStore();
    const r = await loadRhrHistory(
      storeWithThrowingRhr(),
      local,
      '2026-09-07',
      330,
      hrSamples(20),
      START,
      END,
    );

    expect(r.usedFallback).toBe(true);
    expect(r.storeError).toContain('READ_RESTING_HEART_RATE');
    expect(r.history).toHaveLength(1);
    expect(r.history[0].nightDate).toBe('2026-09-07');
  });

  it('survives a local store that cannot be written', async () => {
    const brokenLocal = {
      load: vi.fn(async () => [] as RhrNight[]),
      put: vi.fn(async () => {
        throw new Error('database is locked');
      }),
    };
    const r = await loadRhrHistory(
      storeWithThrowingRhr(),
      brokenLocal,
      '2026-09-07',
      330,
      hrSamples(20),
      START,
      END,
    );
    expect(r.history).toEqual([]);
    expect(r.storeError).toBeTruthy();
  });
});

describe('Health Connect reads are isolated from one another', () => {
  /**
   * A stand-in for the native `readRecords`, able to fail for one record type.
   * The code under test is the real mapping module the bridge delegates to.
   */
  function readRecordsThatFails(
    failFor: 'SleepSession' | 'HeartRate' | 'RestingHeartRate' | null,
  ): ReadRecordsFn {
    return async (recordType: string) => {
      if (recordType === failFor) throw new Error(SECURITY_EXCEPTION);

      if (recordType === 'SleepSession') {
        return {
          records: [
            {
              startTime: '2026-09-06T17:40:00Z',
              endTime: '2026-09-07T01:05:00Z',
              metadata: {
                dataOrigin: 'com.garmin.android.apps.connectmobile',
                recordingMethod: 2,
              },
            },
          ],
        };
      }
      if (recordType === 'HeartRate') {
        return {
          records: [
            {
              metadata: {
                dataOrigin: 'com.garmin.android.apps.connectmobile',
                recordingMethod: 2,
              },
              samples: [{ time: '2026-09-06T18:00:00Z', beatsPerMinute: 58 }],
            },
          ],
        };
      }
      if (recordType === 'RestingHeartRate') {
        return {
          records: [
            {
              time: '2026-09-07T01:00:00Z',
              beatsPerMinute: 52,
              metadata: { dataOrigin: 'com.garmin.android.apps.connectmobile' },
            },
          ],
        };
      }
      return { records: [] };
    };
  }

  it('a failing heart-rate read leaves the sleep session intact', async () => {
    const r = await readNightRecords(readRecordsThatFails('HeartRate'), '2026-09-07', 330);

    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0].sourceId).toBe('com.garmin.android.apps.connectmobile');
    expect(r.hr).toEqual([]);
    expect(r.readErrors.map((e) => e.kind)).toEqual(['hr']);
  });

  it('a failing sleep read leaves the heart rate intact and is flagged', async () => {
    const r = await readNightRecords(readRecordsThatFails('SleepSession'), '2026-09-07', 330);

    expect(r.sessions).toEqual([]);
    expect(r.hr).toHaveLength(1);
    // Critical: the caller must be able to tell this from a genuinely quiet night.
    expect(r.readErrors.map((e) => e.kind)).toEqual(['sleep']);
    expect(r.readErrors[0].message).toContain('SecurityException');
  });

  it('both failing is reported as two errors, not one', async () => {
    const bothFail: ReadRecordsFn = async () => {
      throw new Error(SECURITY_EXCEPTION);
    };
    const r = await readNightRecords(bothFail, '2026-09-07', 330);
    expect(r.readErrors.map((e) => e.kind)).toEqual(['sleep', 'hr']);
  });

  it('a healthy read reports no errors at all', async () => {
    const r = await readNightRecords(readRecordsThatFails(null), '2026-09-07', 330);

    expect(r.sessions).toHaveLength(1);
    expect(r.hr).toHaveLength(1);
    expect(r.readErrors).toEqual([]);
  });

  it('the exact device failure — RHR unreadable — returns [] rather than throwing', async () => {
    const failRhr = readRecordsThatFails('RestingHeartRate');

    await expect(readRhrRecords(failRhr, 45, 330)).resolves.toEqual([]);

    // ...and the night itself is completely unaffected, which is the whole point:
    // on 2026-09-07 this exception blanked every row on the harness.
    const r = await readNightRecords(failRhr, '2026-09-07', 330);
    expect(r.sessions).toHaveLength(1);
    expect(r.hr).toHaveLength(1);
    expect(r.readErrors).toEqual([]);
  });

  it('reads resting heart rate when it is permitted', async () => {
    const nowMs = Date.parse('2026-09-07T06:00:00Z');
    const rhr = await readRhrRecords(readRecordsThatFails(null), 45, 330, nowMs);
    expect(rhr).toEqual([{ nightDate: '2026-09-07', restingBpm: 52 }]);
  });
});
