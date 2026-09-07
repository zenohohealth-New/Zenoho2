/**
 * T-002 engine: derivation → §5 revision/freeze rules → persistence.
 *
 * The SQLite stores cannot run in Node (native module), so these tests drive the
 * engine against an in-memory implementation of the same store contract. That is
 * a real gap and it is named in R-002: the SQL itself is only proven on device.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DerivedNight, HrSample, SleepSession } from '../app/src/derive/types';
import type { HealthStore } from '../app/src/health/types';

const GARMIN = 'com.garmin.android.apps.connectmobile';
const IST = 330;

// ---------------------------------------------------------------------------
// An in-memory stand-in for the daily-state table, wired in by module mock.
// ---------------------------------------------------------------------------
const rows = new Map<string, DerivedNight>();
const key = (c: number, d: string) => `${c}:${d}`;

vi.mock('../app/src/storage/dailyStateStore', () => ({
  STATE_RETENTION_DAYS: 45,
  loadNight: async (c: number, d: string) => rows.get(key(c, d)) ?? null,
  putNight: async (c: number, n: DerivedNight) => {
    rows.set(key(c, n.nightDate), n);
  },
  loadAllNights: async (c: number) =>
    [...rows.entries()]
      .filter(([k]) => k.startsWith(`${c}:`))
      .map(([, v]) => v)
      .sort((a, b) => (a.nightDate < b.nightDate ? -1 : 1)),
  purgeOldStates: async (nowMs: number, days = 45) => {
    const horizon = new Date(nowMs - days * 86_400_000).toISOString().slice(0, 10);
    let n = 0;
    for (const [k, v] of [...rows.entries()]) {
      if (v.nightDate < horizon) {
        rows.delete(k);
        n += 1;
      }
    }
    return n;
  },
  countNights: async (c: number) =>
    [...rows.keys()].filter((k) => k.startsWith(`${c}:`)).length,
}));

const { backfill, deriveAndStoreNight, summariseHistory } = await import(
  '../app/src/engine/nightlyEngine'
);
const { InMemoryRhrHistoryStore } = await import('../app/src/storage/rhrStore');

// ---------------------------------------------------------------------------

const COMMITMENT = { bedTargetMin: 23 * 60, wakeTargetMin: 6 * 60 + 30, toleranceMin: 30 } as const;

/** A night that lands inside tolerance: asleep 23:10, awake 06:35 IST. */
function keptNight(nightDate: string): { sessions: SleepSession[]; hr: HrSample[] } {
  const midnightUtc = Date.parse(`${nightDate}T00:00:00Z`) - IST * 60_000;
  const startMs = midnightUtc - 50 * 60_000; // 23:10 previous day
  const endMs = midnightUtc + (6 * 60 + 35) * 60_000; // 06:35
  const hr: HrSample[] = [];
  for (let t = startMs; t < endMs; t += 10 * 60_000) {
    hr.push({ sourceId: GARMIN, atMs: t, bpm: 58, recordingMethod: 'AUTOMATIC' });
  }
  return {
    sessions: [{ sourceId: GARMIN, startMs, endMs, recordingMethod: 'AUTOMATIC' }],
    hr,
  };
}

function storeFor(
  nightsWithData: readonly string[],
  opts: { rhrFromStore?: boolean; sleepReadFails?: boolean } = {},
): HealthStore {
  return {
    platform: 'android',
    isAvailable: async () => true,
    requestReadPermissions: async () => 'GRANTED',
    hasBackgroundAccess: async () => true,
    readNight: async (nightDate: string) => {
      if (opts.sleepReadFails) {
        return { sessions: [], hr: [], readErrors: [{ kind: 'sleep' as const, message: 'boom' }] };
      }
      if (!nightsWithData.includes(nightDate)) {
        return { sessions: [], hr: [], readErrors: [] };
      }
      const { sessions, hr } = keptNight(nightDate);
      return { sessions, hr, readErrors: [] };
    },
    readRhrHistory: async () =>
      opts.rhrFromStore ? [{ nightDate: '2026-09-01', restingBpm: 54 }] : [],
  };
}

const NOW = Date.parse('2026-09-07T04:00:00Z'); // 09:30 IST, before the 14:00 freeze

function baseOpts(store: HealthStore) {
  return {
    store,
    rhrLocalStore: new InMemoryRhrHistoryStore(),
    commitmentId: 1,
    commitment: COMMITMENT,
    tzOffsetMin: IST,
    nowMs: NOW,
  };
}

beforeEach(() => {
  rows.clear();
});

describe('deriveAndStoreNight', () => {
  it('derives and persists a night', async () => {
    const o = await deriveAndStoreNight({
      ...baseOpts(storeFor(['2026-09-07'])),
      nightDate: '2026-09-07',
    });
    expect(o?.stored.state).toBe('KEPT');
    expect(rows.get('1:2026-09-07')?.state).toBe('KEPT');
  });

  it('AC-2.3: revises once before 14:00, and not twice', async () => {
    const store = storeFor(['2026-09-07']);
    // First pass: no data yet for this night, so NO_DATA is stored.
    await deriveAndStoreNight({
      ...baseOpts(storeFor([])),
      nightDate: '2026-09-07',
    });
    expect(rows.get('1:2026-09-07')?.state).toBe('NO_DATA');

    // Late sync arrives before 14:00 -> revised.
    const second = await deriveAndStoreNight({ ...baseOpts(store), nightDate: '2026-09-07' });
    expect(second?.stored.state).toBe('KEPT');
    expect(second?.stored.revisionCount).toBe(1);

    // A third read must not revise again.
    const third = await deriveAndStoreNight({ ...baseOpts(store), nightDate: '2026-09-07' });
    expect(third?.stored.revisionCount).toBe(1);
    expect(third?.stored.state).toBe('KEPT');
  });

  it('AC-2.3: after 14:00 local the night is frozen and not revised', async () => {
    await deriveAndStoreNight({ ...baseOpts(storeFor([])), nightDate: '2026-09-07' });

    const afternoon = Date.parse('2026-09-07T09:30:00Z'); // 15:00 IST
    const late = await deriveAndStoreNight({
      ...baseOpts(storeFor(['2026-09-07'])),
      nightDate: '2026-09-07',
      nowMs: afternoon,
    });
    expect(late?.stored.state).toBe('NO_DATA');
    expect(late?.stored.frozen).toBe(true);
  });

  it('refuses to store anything when the sleep read failed and nothing exists', async () => {
    const o = await deriveAndStoreNight({
      ...baseOpts(storeFor([], { sleepReadFails: true })),
      nightDate: '2026-09-07',
    });
    expect(o).toBeNull();
    expect(rows.size).toBe(0);
  });
});

describe('backfill', () => {
  it('AC-2.2: stores a row per night, oldest first', async () => {
    const withData = ['2026-09-05', '2026-09-06', '2026-09-07'];
    const r = await backfill(baseOpts(storeFor(withData)), 7);

    expect(r.attempted).toBe(7);
    expect(r.stored).toBe(7);
    expect(r.distribution.KEPT).toBeGreaterThanOrEqual(2);
    expect(r.distribution.NO_DATA).toBeGreaterThanOrEqual(1);
    expect(rows.size).toBe(7);
  });

  it('AC-2.5: purges rows past the retention horizon', async () => {
    rows.set('1:2026-01-01', {
      nightDate: '2026-01-01',
      state: 'NO_DATA',
      integrity: 'NO_SOURCE',
      sourceId: null,
      wearPresence: false,
      deviationMin: null,
      computedAt: NOW,
      frozen: true,
      revisionCount: 0,
    });
    const r = await backfill(baseOpts(storeFor([])), 3);
    expect(r.purged).toBe(1);
    expect(rows.has('1:2026-01-01')).toBe(false);
  });

  it('skips nights it could not read rather than inventing NO_DATA', async () => {
    const r = await backfill(baseOpts(storeFor([], { sleepReadFails: true })), 5);
    expect(r.stored).toBe(0);
    expect(r.skipped).toBe(5);
    expect(rows.size).toBe(0);
  });
});

describe('summariseHistory', () => {
  it('counts the streak and the lifetime kept-count', async () => {
    // backfill(5) from 2026-09-07 covers 09-02..09-06 — today is the caller's job.
    await backfill(baseOpts(storeFor(['2026-09-05', '2026-09-06', '2026-09-07'])), 5);
    const s = await summariseHistory(1);

    expect(s.lifetimeKept).toBe(2);
    // 09-05 and 09-06 are KEPT and most recent; the NO_DATA nights before them
    // neither count nor reset, so the streak is 2.
    expect(s.streak).toBe(2);
  });

  it('backfill leaves today alone so the revision rules still apply to it', async () => {
    await backfill(baseOpts(storeFor(['2026-09-07'])), 5);
    expect(rows.has('1:2026-09-07')).toBe(false);

    const today = await deriveAndStoreNight({
      ...baseOpts(storeFor(['2026-09-07'])),
      nightDate: '2026-09-07',
    });
    // First write, not a revision.
    expect(today?.stored.revisionCount).toBe(0);
  });

  it('flags three consecutive no-data nights', async () => {
    await backfill(baseOpts(storeFor([])), 3);
    const s = await summariseHistory(1);
    expect(s.promptDeviceCheck).toBe(true);
  });
});
