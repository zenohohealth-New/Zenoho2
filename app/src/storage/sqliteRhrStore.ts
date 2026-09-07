/**
 * D-020: the durable RHR history store, backed by the single `expo-sqlite`
 * database. Kept apart from ./rhrStore so the interface, the merge policy and the
 * in-memory test double stay importable from pure Node tests.
 *
 * D-010: these values never leave the device.
 */
import type { RhrNight } from '../derive/types';
import { getDb } from './db';
import { RHR_HISTORY_DAYS, type RhrHistoryStore } from './rhrStore';

interface RhrRow {
  night_date: string;
  resting_bpm: number;
}

/** D-020: the production store. Survives restarts, which is the whole point. */
export class SqliteRhrHistoryStore implements RhrHistoryStore {
  constructor(private readonly keepDays: number = RHR_HISTORY_DAYS) {}

  async load(): Promise<RhrNight[]> {
    const db = await getDb();
    // Newest `keepDays` rows, then flipped back to oldest-first for the caller.
    const rows = await db.getAllAsync<RhrRow>(
      'SELECT night_date, resting_bpm FROM rhr_nights ORDER BY night_date DESC LIMIT ?;',
      [this.keepDays],
    );
    return rows
      .map((r) => ({ nightDate: r.night_date, restingBpm: r.resting_bpm }))
      .reverse();
  }

  async put(night: RhrNight): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO rhr_nights (night_date, resting_bpm) VALUES (?, ?)
       ON CONFLICT(night_date) DO UPDATE SET resting_bpm = excluded.resting_bpm;`,
      [night.nightDate, night.restingBpm],
    );
    // Same retention rule as `mergeRhrNight`, enforced where the rows actually live.
    await db.runAsync(
      `DELETE FROM rhr_nights WHERE night_date NOT IN (
         SELECT night_date FROM rhr_nights ORDER BY night_date DESC LIMIT ?
       );`,
      [this.keepDays],
    );
  }
}
