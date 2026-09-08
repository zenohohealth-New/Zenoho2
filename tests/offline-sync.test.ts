/**
 * T-003-R: the offline path, which is the whole privacy thesis in practice.
 *
 * D-010 says derivation happens on device. If a verdict cannot be produced with
 * the radio off, that claim is architectural fiction — so these tests hold the
 * line in two places:
 *
 *  - **Structure** (`vi.mock`-free, source-level): derivation must not be able to
 *    reach the backend at all, queueing must not sit behind a round trip, and a
 *    foreground drain must exist. These are the three things that were actually
 *    wrong; each assertion below fails against the code as it shipped in
 *    `e1a3bdd4`, which is the only reason to trust them.
 *  - **Behaviour**: `drainQueue` against a faked Supabase and a faked queue —
 *    offline, signed out, idempotent re-drain, and partial failure.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const winPath = (u: URL) => u.pathname.replace(/^\/([A-Za-z]:)/, '$1');
const APP = new URL('../app/', import.meta.url);
const read = (rel: string) => readFileSync(winPath(new URL(rel, APP)), 'utf8');

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------- structure --

describe('derivation is local by construction', () => {
  it('the nightly engine imports nothing from src/backend', () => {
    // The engine is what produces a verdict. If it can import the backend, then
    // "works offline" is a property of today's call order rather than of the
    // design, and the next edit can quietly take it away.
    const engine = stripComments(read('src/engine/nightlyEngine.ts'));
    expect(engine).not.toMatch(/from '\.\.\/backend/);
    expect(engine).not.toMatch(/fetch\(/);
  });

  it('the derive layer imports nothing from src/backend or src/net', () => {
    for (const f of ['src/derive/index.ts', 'src/derive/types.ts']) {
      const src = stripComments(read(f));
      expect(src, f).not.toMatch(/from '\.\.\/(backend|net)/);
    }
  });
});

describe('queueing a night cannot depend on the network', () => {
  const sync = stripComments(read('src/backend/sync.ts'));

  it('queueNight awaits nothing but the local enqueue', () => {
    const body = /export async function queueNight\([\s\S]*?\n}/.exec(sync)?.[0];
    expect(body).toBeDefined();
    // The defect: `auth.getUser()` is a round trip to /auth/v1/user, and the
    // enqueue used to sit behind it, so a night derived offline was never queued.
    expect(body).not.toMatch(/getUser|getSupabase|ensureRemoteCommitment|serverNow/);
    expect(body).toMatch(/enqueue\(/);
  });

  it('App.tsx queues before it does anything that needs a server', () => {
    const app = stripComments(read('../app/App.tsx'));
    const queueAt = app.indexOf('queueNight(');
    const pushAt = app.indexOf('pushPending(');
    expect(queueAt).toBeGreaterThan(-1);
    expect(pushAt).toBeGreaterThan(-1);
    expect(queueAt).toBeLessThan(pushAt);
    // And it must not be nested inside a signed-in check the way it once was.
    expect(app).not.toMatch(/if \(data\.user\)[\s\S]{0,200}queueNight/);
  });
});

describe('the foreground drain exists (deliverable 4)', () => {
  const app = stripComments(read('../app/App.tsx'));

  it('registers exactly one AppState listener', () => {
    expect(app).toMatch(/AppState\.addEventListener\('change'/);
    expect(app.match(/AppState\.addEventListener/g)).toHaveLength(1);
  });

  it('drains only on becoming active, and removes the listener', () => {
    expect(app).toMatch(/next !== 'active'/);
    expect(app).toMatch(/sub\.remove\(\)/);
  });

  it('adds no routing or background-scheduling dependency', () => {
    // The task named these explicitly as things not to reach for.
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    for (const banned of [
      '@react-navigation/native',
      'expo-background-fetch',
      'expo-task-manager',
      'expo-router',
    ]) {
      expect(Object.keys(pkg.dependencies)).not.toContain(banned);
    }
  });
});

describe('a tap always produces visible feedback (DEF-003-01)', () => {
  const app = stripComments(read('../app/App.tsx'));
  const screen = stripComments(read('src/ui/HistoryScreen.tsx'));

  it('the note is set in a finally, so no path can leave it unset', () => {
    expect(app).toMatch(/finally \{\s*setCheckNote\(note\);/);
  });

  it('the note renders next to the button, not at the top of the scroll view', () => {
    const buttonAt = screen.indexOf('Check last night');
    const noteAt = screen.indexOf('p.checkNote');
    const bannerAt = screen.indexOf('p.error !== null');
    expect(buttonAt).toBeGreaterThan(-1);
    expect(noteAt).toBeGreaterThan(buttonAt);
    // The banner is above the thirty-row list; the note must not be up there
    // with it, because that is precisely what made the tap look like a no-op.
    expect(bannerAt).toBeLessThan(buttonAt);
    // And it must be nearer the button than the banner is — "next to" is the
    // property under test, not merely "somewhere below".
    expect(noteAt - buttonAt).toBeLessThan(buttonAt - bannerAt);
  });
});

// ---------------------------------------------------------------- behaviour --

interface FakeRow {
  nightDate: string;
  payload: Record<string, unknown>;
}

const queue: FakeRow[] = [];
const upserts: Record<string, unknown>[] = [];
let session: unknown = { user: { id: 'u1' } };
let upsertError: { message: string } | null = null;

vi.mock('../app/src/backend/syncQueue', () => ({
  pending: async () => queue.map((r) => ({ ...r, queuedAt: 0, attempts: 0, lastError: null })),
  markSent: async (n: string) => {
    const i = queue.findIndex((r) => r.nightDate === n);
    if (i >= 0) queue.splice(i, 1);
  },
  markFailed: async () => {},
  pendingCount: async () => queue.length,
  enqueue: async () => {},
  clearQueue: async () => {
    queue.length = 0;
  },
}));

vi.mock('../app/src/backend/client', () => ({
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session } }) },
    from: () => ({
      upsert: async (row: Record<string, unknown>) => {
        if (upsertError) return { error: upsertError };
        upserts.push(row);
        return { error: null };
      },
    }),
  }),
}));

// storage/kv reaches expo-sqlite and therefore react-native, which vitest cannot
// parse. The queue and client are already faked; this keeps the import graph in
// pure TypeScript so the drain logic can be tested at all.
vi.mock('../app/src/storage/kv', () => ({
  KEY_REMOTE_COMMITMENT_ID: 'remote.commitment.id',
  KEY_CLOCK_OFFSET_MIN: 'clock.offset.min',
  kvGetNumber: async () => 42,
  kvSetNumber: async () => {},
  kvGet: async () => null,
  kvSet: async () => {},
}));

vi.mock('../app/src/backend/clockSkew', () => ({
  getDeviceClockOffsetMin: async () => 3,
}));

const { drainQueue, UNSTAMPED_COMMITMENT_ID } = await import('../app/src/backend/sync');

const LOCAL = {
  id: 1,
  bedTargetMin: 1380,
  wakeTargetMin: 420,
  toleranceMin: 30,
} as never;

function queueNightRow(nightDate: string) {
  queue.push({
    nightDate,
    payload: {
      commitment_id: UNSTAMPED_COMMITMENT_ID,
      night_date: nightDate,
      state: 'KEPT',
      integrity: 'FULL',
      source_id: 'garmin',
      wear_presence: true,
      deviation_min: 12,
      frozen: false,
      device_clock_offset_min: null,
    },
  });
}

describe('drainQueue', () => {
  beforeEach(() => {
    queue.length = 0;
    upserts.length = 0;
    session = { user: { id: 'u1' } };
    upsertError = null;
    vi.stubGlobal('__DEV__', false);
  });

  it('an empty queue is a no-op that reports success', async () => {
    const r = await drainQueue(LOCAL);
    expect(r).toEqual({ sent: 0, failed: 0, remaining: 0, stoppedBecause: null });
  });

  it('signed out: keeps the night queued rather than dropping it', async () => {
    session = null;
    queueNightRow('2026-09-07');
    const r = await drainQueue(LOCAL);
    expect(r.sent).toBe(0);
    expect(r.remaining).toBe(1);
    expect(r.stoppedBecause).toBe('not signed in');
    expect(queue).toHaveLength(1);
  });

  it('stamps the commitment id and clock offset at upload, not at derivation', async () => {
    queueNightRow('2026-09-07');
    await drainQueue(LOCAL);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].commitment_id).not.toBe(UNSTAMPED_COMMITMENT_ID);
    expect(upserts[0].device_clock_offset_min).toBe(3);
  });

  it('uploads the verdict exactly as derived (AC-R4)', async () => {
    queueNightRow('2026-09-07');
    await drainQueue(LOCAL);
    // The five fields AC-R4 compares must survive the round trip untouched.
    expect(upserts[0]).toMatchObject({
      state: 'KEPT',
      deviation_min: 12,
      source_id: 'garmin',
      wear_presence: true,
      night_date: '2026-09-07',
    });
  });

  it('is idempotent: re-draining sends nothing and does not error (AC-R7)', async () => {
    queueNightRow('2026-09-07');
    const first = await drainQueue(LOCAL);
    const second = await drainQueue(LOCAL);
    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(second.stoppedBecause).toBeNull();
    expect(upserts).toHaveLength(1);
  });

  it('a failure stops the drain and leaves the rest queued', async () => {
    queueNightRow('2026-09-06');
    queueNightRow('2026-09-07');
    upsertError = { message: 'network request failed' };
    const r = await drainQueue(LOCAL);
    expect(r.sent).toBe(0);
    expect(r.failed).toBe(1);
    expect(r.remaining).toBe(2);
    expect(queue).toHaveLength(2);
  });

  it('never throws when there is no local commitment to stamp from', async () => {
    queueNightRow('2026-09-07');
    const r = await drainQueue(undefined);
    expect(r.stoppedBecause).toBe('no local commitment');
    expect(queue).toHaveLength(1);
  });
});

describe('the queue table survives an app kill', () => {
  it('is a SQLite table, not in-memory state', () => {
    // AC-R6 is a device criterion, but the property it rests on is checkable
    // here: the queue lives in the same durable store as everything else, so a
    // force-kill cannot lose it.
    const db = read('src/storage/db.ts');
    expect(db).toMatch(/CREATE TABLE IF NOT EXISTS sync_queue/);
    expect(db).toMatch(/night_date\s+TEXT PRIMARY KEY NOT NULL/);
    const q = stripComments(read('src/backend/syncQueue.ts'));
    expect(q).toMatch(/getDb\(\)/);
    expect(q).not.toMatch(/new Map\(|let queue\s*=|\[\]\s*;/);
  });
});
