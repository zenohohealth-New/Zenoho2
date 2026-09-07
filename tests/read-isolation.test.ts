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
import { wearPresence } from '../app/src/derive/wear';

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

describe('heart rate is read for the sleep session, not the whole window', () => {
  /**
   * Regression for R-001 device run 2 (S26 Ultra, 2026-09-07): the harness read
   * exactly 1000 heart-rate samples and still reported a 0% wear ratio.
   *
   * Health Connect caps one read at 1000 records and returns them oldest-first,
   * so an unpaginated read of the 36-hour window returned samples from the day
   * BEFORE the night, none of which overlapped the sleep session.
   */
  const SESSION_START = Date.parse('2026-09-06T17:40:00Z'); // 23:10 IST
  const SESSION_END = Date.parse('2026-09-07T01:05:00Z'); // 06:35 IST

  function hrRecordsBetween(fromMs: number, toMs: number, everyMin: number) {
    const samples = [];
    for (let t = fromMs; t < toMs; t += everyMin * 60_000) {
      samples.push({ time: new Date(t).toISOString(), beatsPerMinute: 58 });
    }
    return [
      {
        metadata: {
          dataOrigin: 'com.garmin.android.apps.connectmobile',
          recordingMethod: 2,
        },
        samples,
      },
    ];
  }

  /**
   * Mimics Health Connect: honours the requested range, returns at most
   * `pageSize` records oldest-first, and hands back a pageToken when more remain.
   */
  function pagingReadRecords(everyMin: number): ReadRecordsFn {
    return async (recordType, options) => {
      if (recordType === 'SleepSession') {
        return {
          records: [
            {
              startTime: new Date(SESSION_START).toISOString(),
              endTime: new Date(SESSION_END).toISOString(),
              metadata: {
                dataOrigin: 'com.garmin.android.apps.connectmobile',
                recordingMethod: 2,
              },
            },
          ],
        };
      }
      if (recordType !== 'HeartRate') return { records: [] };

      const from = Date.parse(options.timeRangeFilter.startTime);
      const to = Date.parse(options.timeRangeFilter.endTime);
      const all = hrRecordsBetween(from, to, everyMin)[0].samples;

      const offset = options.pageToken ? Number(options.pageToken) : 0;
      const size = options.pageSize ?? 1000;
      const page = all.slice(offset, offset + size);
      const next = offset + size < all.length ? String(offset + size) : undefined;

      return {
        records: [
          {
            metadata: {
              dataOrigin: 'com.garmin.android.apps.connectmobile',
              recordingMethod: 2,
            },
            samples: page,
          },
        ],
        pageToken: next,
      };
    };
  }

  it('returns heart rate that actually overlaps the session', async () => {
    // One sample a minute across a 36h window is far past the 1000 cap, which is
    // what the device hit. Before the fix, every sample came back from the wrong day.
    const r = await readNightRecords(pagingReadRecords(1), '2026-09-07', 330);

    expect(r.sessions).toHaveLength(1);
    expect(r.hr.length).toBeGreaterThan(0);

    const inSession = r.hr.filter(
      (h) => h.atMs >= SESSION_START && h.atMs < SESSION_END,
    );
    expect(inSession.length).toBeGreaterThan(0);
    // The point of the fix: essentially everything read is inside the session.
    expect(inSession.length).toBe(r.hr.length);
  });

  it('the samples cover the session densely enough to prove wear', async () => {
    const r = await readNightRecords(pagingReadRecords(1), '2026-09-07', 330);
    const w = wearPresence(r.hr, SESSION_START, SESSION_END);

    expect(w.ratio).toBe(1);
    expect(w.present).toBe(true);
  });

  it('paginates rather than stopping at the first page', async () => {
    // 5h25m of one-per-minute samples inside the session is 445 -- under the cap.
    // Force paging by shrinking the page size through a sparse-window read.
    const calls: (string | undefined)[] = [];
    const counting: ReadRecordsFn = async (recordType, options) => {
      const inner = pagingReadRecords(1);
      if (recordType === 'HeartRate') calls.push(options.pageToken);
      return inner(recordType, { ...options, pageSize: 100 });
    };

    const r = await readNightRecords(counting, '2026-09-07', 330);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[0]).toBeUndefined();
    // 445 minutes of samples at 100 per page.
    expect(r.hr.length).toBe(445);
  });

  it('a night whose heart rate sits outside the session still reads NO_WEAR', async () => {
    // The honest negative: HR exists in the 36h window but none of it is in the
    // session. Scoping must not invent coverage that is not there.
    const hrElsewhere: ReadRecordsFn = async (recordType) => {
      if (recordType === 'SleepSession') {
        return {
          records: [
            {
              startTime: new Date(SESSION_START).toISOString(),
              endTime: new Date(SESSION_END).toISOString(),
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
          records: hrRecordsBetween(
            SESSION_START - 6 * 60 * 60_000,
            SESSION_START - 60_000,
            1,
          ),
        };
      }
      return { records: [] };
    };

    const r = await readNightRecords(hrElsewhere, '2026-09-07', 330);
    const w = wearPresence(r.hr, SESSION_START, SESSION_END);
    expect(w.present).toBe(false);
    expect(w.ratio).toBe(0);
  });
});
