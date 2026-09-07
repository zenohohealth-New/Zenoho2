/**
 * Nightly states, stored on device (D-020, spec §8 column list).
 *
 * Retention: the T-001 constraint purges anything older than 45 days. States are
 * derived facts, not raw health data, but they are kept to the same horizon so
 * there is one retention rule on the device rather than two.
 *
 * D-010: nothing here is uploaded in T-002; there is no upload path at all.
 */
import type { DailyStateValue, DerivedNight, IntegrityFlag } from '../derive/types';
import { getDb } from './db';

export const STATE_RETENTION_DAYS = 45;

/** Spec §5: 3 consecutive NO_DATA nights prompt the member to check their device. */
export const HISTORY_PAGE_NIGHTS = 30;

interface StateRow {
  commitment_id: number;
  night_date: string;
  state: string;
  integrity: string;
  source_id: string | null;
  wear_presence: number;
  deviation_min: number | null;
  computed_at: number;
  frozen: number;
  revision_count: number;
}

const toNight = (r: StateRow): DerivedNight => ({
  nightDate: r.night_date,
  state: r.state as DailyStateValue,
  integrity: r.integrity as IntegrityFlag,
  sourceId: r.source_id,
  wearPresence: r.wear_presence === 1,
  deviationMin: r.deviation_min,
  computedAt: r.computed_at,
  frozen: r.frozen === 1,
  revisionCount: r.revision_count,
});

/** One night, or null when it has never been derived. */
export async function loadNight(
  commitmentId: number,
  nightDate: string,
): Promise<DerivedNight | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<StateRow>(
    'SELECT * FROM daily_states WHERE commitment_id = ? AND night_date = ?;',
    [commitmentId, nightDate],
  );
  return row ? toNight(row) : null;
}

/** Recent nights, oldest first, capped at `limit`. */
export async function loadRecentNights(
  commitmentId: number,
  limit: number = HISTORY_PAGE_NIGHTS,
): Promise<DerivedNight[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<StateRow>(
    `SELECT * FROM daily_states WHERE commitment_id = ?
     ORDER BY night_date DESC LIMIT ?;`,
    [commitmentId, limit],
  );
  return rows.map(toNight).reverse();
}

/** Every stored night for a commitment, oldest first. Used for lifetime counters. */
export async function loadAllNights(commitmentId: number): Promise<DerivedNight[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<StateRow>(
    'SELECT * FROM daily_states WHERE commitment_id = ? ORDER BY night_date ASC;',
    [commitmentId],
  );
  return rows.map(toNight);
}

/** Insert or replace one night. The primary key enforces one row per night. */
export async function putNight(
  commitmentId: number,
  night: DerivedNight,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO daily_states (
       commitment_id, night_date, state, integrity, source_id,
       wear_presence, deviation_min, computed_at, frozen, revision_count
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(commitment_id, night_date) DO UPDATE SET
       state = excluded.state,
       integrity = excluded.integrity,
       source_id = excluded.source_id,
       wear_presence = excluded.wear_presence,
       deviation_min = excluded.deviation_min,
       computed_at = excluded.computed_at,
       frozen = excluded.frozen,
       revision_count = excluded.revision_count;`,
    [
      commitmentId,
      night.nightDate,
      night.state,
      night.integrity,
      night.sourceId,
      night.wearPresence ? 1 : 0,
      night.deviationMin,
      night.computedAt,
      night.frozen ? 1 : 0,
      night.revisionCount,
    ],
  );
}

/** Drop states older than the retention horizon. Returns how many rows went. */
export async function purgeOldStates(
  nowMs: number = Date.now(),
  retentionDays: number = STATE_RETENTION_DAYS,
): Promise<number> {
  const db = await getDb();
  const horizon = new Date(nowMs - retentionDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const result = await db.runAsync('DELETE FROM daily_states WHERE night_date < ?;', [
    horizon,
  ]);
  return result.changes;
}

/** Row count, for the report's before/after evidence (AC-2.4, AC-2.5). */
export async function countNights(commitmentId: number): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM daily_states WHERE commitment_id = ?;',
    [commitmentId],
  );
  return row?.n ?? 0;
}
