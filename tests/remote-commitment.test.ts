/**
 * DEF-005-06 — a reinstall must adopt the account's existing promise, not mint
 * a second one.
 *
 * `ensureRemoteCommitment` inserted unconditionally whenever the local key/value
 * cache was empty, and a reinstall wipes that cache. So every fresh install
 * created another commitment row for the same person: two promises the server
 * believes in, and a local history truncated at the reinstall, because
 * `catchUpMissingNights` cuts at the *local* `createdAt`. A second device did
 * exactly the same thing.
 *
 * These run the real `sync.ts` against a faked PostgREST, so the adopt-vs-create
 * branch is exercised rather than described.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredCommitment } from '../app/src/storage/commitmentStore';

interface Row {
  id: number;
  bed_target_min: number;
  wake_target_min: number;
  tolerance_min: number;
  created_at: string;
}

/** The server's commitments table for the signed-in user. */
let commitments: Row[] = [];
let inserted: Record<string, unknown>[] = [];
let kv: Record<string, number | null> = {};
let nextId = 1;

vi.mock('../app/src/storage/kv', () => ({
  KEY_REMOTE_COMMITMENT_ID: 'remote.commitment.id',
  KEY_CLOCK_OFFSET_MIN: 'clock.offset.min',
  kvGetNumber: async (k: string) => kv[k] ?? null,
  kvSetNumber: async (k: string, v: number) => {
    kv[k] = v;
  },
  kvGet: async () => null,
  kvSet: async () => {},
}));

vi.mock('../app/src/backend/clockSkew', () => ({
  getDeviceClockOffsetMin: async () => 0,
}));

vi.mock('../app/src/backend/syncQueue', () => ({
  pending: async () => [],
  pendingCount: async () => 0,
  enqueue: async () => {},
  markSent: async () => {},
  markFailed: async () => {},
  clearQueue: async () => {},
}));

vi.mock('../app/src/backend/client', () => ({
  getSupabase: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } } }),
      getSession: async () => ({ data: { session: { user: { id: 'user-1' } } } }),
    },
    from: (table: string) => {
      if (table === 'users') {
        return { upsert: async () => ({ error: null }) };
      }
      // commitments
      const builder = {
        // read path: .select().order().limit()
        select: () => builder,
        order: () => builder,
        limit: async () => ({ data: [...commitments], error: null }),
        // write path: .insert().select().single()
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          const created: Row = {
            id: nextId++,
            bed_target_min: Number(row.bed_target_min),
            wake_target_min: Number(row.wake_target_min),
            tolerance_min: Number(row.tolerance_min),
            created_at: '2026-09-14T00:00:00Z',
          };
          commitments.push(created);
          return {
            select: () => ({ single: async () => ({ data: { id: created.id }, error: null }) }),
          };
        },
      };
      return builder;
    },
  }),
}));

const { ensureRemoteCommitment, fetchRemoteCommitment } = await import(
  '../app/src/backend/sync'
);

/** What a fresh install has locally: a brand-new promise made today. */
const FRESH_LOCAL: StoredCommitment = {
  id: 1,
  bedTargetMin: 1380,
  wakeTargetMin: 420,
  toleranceMin: 30,
  createdAt: Date.parse('2026-09-14T09:00:00Z'),
};

beforeEach(() => {
  commitments = [];
  inserted = [];
  kv = {};
  nextId = 1;
});

describe('fresh install with an existing server commitment', () => {
  beforeEach(() => {
    // The promise the founder actually made, on the 8th.
    commitments = [
      {
        id: 2,
        bed_target_min: 1380,
        wake_target_min: 420,
        tolerance_min: 30,
        created_at: '2026-09-08T17:30:00Z',
      },
    ];
  });

  it('adopts the existing row and creates nothing', async () => {
    const id = await ensureRemoteCommitment(FRESH_LOCAL);
    expect(id).toBe(2);
    expect(inserted).toHaveLength(0);
    expect(commitments).toHaveLength(1);
  });

  it('caches the adopted id, so the next call makes no request at all', async () => {
    await ensureRemoteCommitment(FRESH_LOCAL);
    expect(kv['remote.commitment.id']).toBe(2);
    await ensureRemoteCommitment(FRESH_LOCAL);
    expect(inserted).toHaveLength(0);
  });

  it('returns the original created_at, which is what the catch-up cuts at', async () => {
    const remote = await fetchRemoteCommitment();
    expect(remote?.createdAtMs).toBe(Date.parse('2026-09-08T17:30:00Z'));
    // The local row says the 14th. Cutting there is DEF-005-06: it would hide
    // every night between the promise and the reinstall.
    expect(remote?.createdAtMs).toBeLessThan(FRESH_LOCAL.createdAt);
  });

  it('restores the promise itself, not just its id', async () => {
    const remote = await fetchRemoteCommitment();
    expect(remote).toMatchObject({
      id: 2,
      bedTargetMin: 1380,
      wakeTargetMin: 420,
      toleranceMin: 30,
    });
  });

  it('adopts the EARLIEST commitment when the account already has several', async () => {
    // The state the founder's account is already in. A later row would shorten
    // the history all over again.
    commitments = [
      {
        id: 2,
        bed_target_min: 1380,
        wake_target_min: 420,
        tolerance_min: 30,
        created_at: '2026-09-08T17:30:00Z',
      },
      {
        id: 9,
        bed_target_min: 1380,
        wake_target_min: 420,
        tolerance_min: 30,
        created_at: '2026-09-14T09:00:00Z',
      },
    ];
    const remote = await fetchRemoteCommitment();
    // The fake returns them in the order given; the real query orders by
    // created_at ascending, which this asserts we rely on.
    expect(remote?.id).toBe(2);
  });
});

describe('fresh install with no server commitment', () => {
  it('creates one, exactly once', async () => {
    const id = await ensureRemoteCommitment(FRESH_LOCAL);
    expect(inserted).toHaveLength(1);
    expect(commitments).toHaveLength(1);
    expect(id).toBe(1);
  });

  it('sends only the four whitelisted columns (DEF-005-02)', async () => {
    await ensureRemoteCommitment(FRESH_LOCAL);
    expect(Object.keys(inserted[0]).sort()).toEqual([
      'bed_target_min',
      'tolerance_min',
      'user_id',
      'wake_target_min',
    ]);
  });

  it('a second call adopts what the first created rather than duplicating', async () => {
    await ensureRemoteCommitment(FRESH_LOCAL);
    kv = {}; // simulate the reinstall that wiped the cache
    const id = await ensureRemoteCommitment(FRESH_LOCAL);
    expect(inserted).toHaveLength(1);
    expect(commitments).toHaveLength(1);
    expect(id).toBe(1);
  });

  it('returns null from the fetch when the account is genuinely new', async () => {
    expect(await fetchRemoteCommitment()).toBeNull();
  });
});
