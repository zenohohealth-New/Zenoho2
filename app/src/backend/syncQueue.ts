/**
 * The outbound queue for derived nights (T-003 deliverable 4, AC-3.6).
 *
 * Every derivation enqueues its §7 row; the queue drains on the next foreground.
 * A night derived in airplane mode therefore reaches the server on its own, with
 * no user action — which is the whole of AC-3.6.
 *
 * The queue is keyed by night date, so re-deriving a night replaces its pending
 * payload rather than queueing a second one. The server upsert is on
 * (commitment_id, night_date) for the same reason: draining twice is harmless.
 *
 * D-010: the payload is whatever `toServerRow` produced and nothing else. No raw
 * health value can be in here, because none can be in that.
 */
import { getDb } from '../storage/db';
import type { ServerDailyStateRow } from '../net/payload';

export interface QueuedRow {
  readonly nightDate: string;
  readonly payload: ServerDailyStateRow;
  readonly queuedAt: number;
  readonly attempts: number;
  readonly lastError: string | null;
}

interface QueueRecord {
  night_date: string;
  payload: string;
  queued_at: number;
  attempts: number;
  last_error: string | null;
}

/** Add or replace the pending payload for a night. */
export async function enqueue(
  row: ServerDailyStateRow,
  nowMs: number = Date.now(),
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO sync_queue (night_date, payload, queued_at, attempts, last_error)
     VALUES (?, ?, ?, 0, NULL)
     ON CONFLICT(night_date) DO UPDATE SET
       payload = excluded.payload,
       queued_at = excluded.queued_at,
       attempts = 0,
       last_error = NULL;`,
    [row.night_date, JSON.stringify(row), nowMs],
  );
}

export async function pending(limit = 100): Promise<QueuedRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<QueueRecord>(
    'SELECT * FROM sync_queue ORDER BY night_date ASC LIMIT ?;',
    [limit],
  );
  return rows.map((r) => ({
    nightDate: r.night_date,
    payload: JSON.parse(r.payload) as ServerDailyStateRow,
    queuedAt: r.queued_at,
    attempts: r.attempts,
    lastError: r.last_error,
  }));
}

export async function markSent(nightDate: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM sync_queue WHERE night_date = ?;', [nightDate]);
}

/**
 * Record a failure without dropping the row. Attempts are counted so the
 * diagnostics screen can show a stuck queue rather than failing silently.
 */
export async function markFailed(nightDate: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE sync_queue SET attempts = attempts + 1, last_error = ?
     WHERE night_date = ?;`,
    [error.slice(0, 500), nightDate],
  );
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM sync_queue;',
  );
  return row?.n ?? 0;
}

/** Used by account deletion: the queue is local data and goes with everything else. */
export async function clearQueue(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM sync_queue;');
}
