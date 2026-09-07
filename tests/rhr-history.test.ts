/**
 * D-017: resting-heart-rate history — store-provided first, on-device 10th
 * percentile as the fallback, persisted locally and never uploaded (D-010).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  deriveNightlyRhr,
  RHR_FALLBACK_MIN_SAMPLES,
} from '../app/src/derive/rhr';
import {
  InMemoryRhrHistoryStore,
  mergeRhrNight,
  RHR_HISTORY_DAYS,
} from '../app/src/storage/rhrStore';
import { loadRhrHistory } from '../app/src/health/rhrHistory';
import type { HrSample, RhrNight } from '../app/src/derive/types';
import type { HealthStore } from '../app/src/health/types';

const START = Date.parse('2026-09-06T17:40:00Z');
const END = Date.parse('2026-09-07T01:05:00Z');

function samples(bpms: number[], sourceId = 'com.garmin.android.apps.connectmobile'): HrSample[] {
  return bpms.map((bpm, i) => ({
    sourceId,
    atMs: START + i * 60_000,
    bpm,
    recordingMethod: 'AUTOMATIC' as const,
  }));
}

/** A store that exposes no resting-heart-rate record, forcing the fallback. */
function storeWithoutRhr(): HealthStore {
  return {
    platform: 'android',
    isAvailable: vi.fn(async () => true),
    requestReadPermissions: vi.fn(async () => 'GRANTED' as const),
    hasBackgroundAccess: vi.fn(async () => false),
    readNight: vi.fn(async () => ({ sessions: [], hr: [] })),
    readRhrHistory: vi.fn(async () => [] as RhrNight[]),
  };
}

describe('deriveNightlyRhr — D-017 fallback', () => {
  it('takes the 10th percentile of the sleep window, not the minimum', () => {
    // 20 samples, 50..69. Nearest-rank 10th percentile = index 1 = 51.
    const bpms = Array.from({ length: 20 }, (_, i) => 50 + i);
    expect(deriveNightlyRhr(samples(bpms), START, END)).toBe(51);
  });

  it('is unmoved by a handful of high daytime-ish spikes', () => {
    const bpms = [...Array.from({ length: 18 }, (_, i) => 55 + i), 140, 150];
    expect(deriveNightlyRhr(samples(bpms), START, END)).toBe(56);
  });

  it('returns null rather than guessing when samples are too few', () => {
    const bpms = Array.from({ length: RHR_FALLBACK_MIN_SAMPLES - 1 }, () => 60);
    expect(deriveNightlyRhr(samples(bpms), START, END)).toBeNull();
  });

  it('ignores samples outside the sleep window', () => {
    const inside = samples(Array.from({ length: 12 }, () => 60));
    const outside: HrSample[] = [
      { sourceId: 'x', atMs: END + 60_000, bpm: 200, recordingMethod: 'AUTOMATIC' },
    ];
    expect(deriveNightlyRhr([...inside, ...outside], START, END)).toBe(60);
  });

  it('honours the source filter, so phone HR cannot set the baseline', () => {
    const good = samples(Array.from({ length: 12 }, () => 60));
    const phone = samples(Array.from({ length: 12 }, () => 30), 'com.phone.os');
    const accept = (s: HrSample) => s.sourceId !== 'com.phone.os';
    expect(deriveNightlyRhr([...good, ...phone], START, END, accept)).toBe(60);
  });
});

describe('local RHR history', () => {
  it('merges one night per date, newest last', () => {
    const h = mergeRhrNight(
      [{ nightDate: '2026-09-05', restingBpm: 55 }],
      { nightDate: '2026-09-06', restingBpm: 57 },
    );
    expect(h.map((n) => n.nightDate)).toEqual(['2026-09-05', '2026-09-06']);
  });

  it('overwrites a re-derived night rather than duplicating it', () => {
    const h = mergeRhrNight(
      [{ nightDate: '2026-09-06', restingBpm: 55 }],
      { nightDate: '2026-09-06', restingBpm: 60 },
    );
    expect(h).toEqual([{ nightDate: '2026-09-06', restingBpm: 60 }]);
  });

  it('trims to the retention window', () => {
    let h: RhrNight[] = [];
    for (let i = 0; i < RHR_HISTORY_DAYS + 10; i += 1) {
      const d = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000);
      h = mergeRhrNight(h, { nightDate: d.toISOString().slice(0, 10), restingBpm: 55 });
    }
    expect(h).toHaveLength(RHR_HISTORY_DAYS);
  });
});

describe('loadRhrHistory', () => {
  it('prefers the health store when it has resting-heart-rate records', async () => {
    const fromStore: RhrNight[] = [{ nightDate: '2026-09-06', restingBpm: 54 }];
    const store: HealthStore = { ...storeWithoutRhr(), readRhrHistory: vi.fn(async () => fromStore) };
    const local = new InMemoryRhrHistoryStore();

    const r = await loadRhrHistory(store, local, '2026-09-07', 330, [], START, END);
    expect(r.usedFallback).toBe(false);
    expect(r.history).toEqual(fromStore);
    // Nothing was written locally, because nothing had to be derived.
    expect(await local.load()).toEqual([]);
  });

  it('falls back to the derived percentile and persists it', async () => {
    const store = storeWithoutRhr();
    const local = new InMemoryRhrHistoryStore();
    const hr = samples(Array.from({ length: 20 }, (_, i) => 50 + i));

    const r = await loadRhrHistory(store, local, '2026-09-07', 330, hr, START, END);
    expect(r.usedFallback).toBe(true);
    expect(r.history).toEqual([{ nightDate: '2026-09-07', restingBpm: 51 }]);
    expect(await local.load()).toHaveLength(1);
  });

  it('persists nothing when the night had no main session', async () => {
    const store = storeWithoutRhr();
    const local = new InMemoryRhrHistoryStore();
    const hr = samples(Array.from({ length: 20 }, () => 60));

    const r = await loadRhrHistory(store, local, '2026-09-07', 330, hr, null, null);
    expect(r.usedFallback).toBe(true);
    expect(r.history).toEqual([]);
  });

  it('accumulates across nights so a 30-night baseline can form', async () => {
    const store = storeWithoutRhr();
    const local = new InMemoryRhrHistoryStore();

    for (let i = 0; i < 3; i += 1) {
      const night = `2026-09-0${i + 1}`;
      await loadRhrHistory(
        store,
        local,
        night,
        330,
        samples(Array.from({ length: 20 }, () => 55 + i)),
        START,
        END,
      );
    }
    expect((await local.load()).map((n) => n.nightDate)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
  });
});
