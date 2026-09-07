/**
 * The single on-device database (D-020).
 *
 * `expo-sqlite` holds everything Zenoho keeps locally: `rhr_nights` now, and the
 * local cache of `daily_states` from T-002. One store rather than several keeps
 * the 45-day purge auditable in one place.
 *
 * D-010: nothing in this database is ever uploaded. It exists precisely so that
 * derivation can happen on the phone.
 */
import * as SQLite from 'expo-sqlite';

export const DB_NAME = 'zenoho.db';

/**
 * Schema version, bumped whenever `MIGRATIONS` grows. Stored in SQLite's own
 * `user_version` pragma so no bookkeeping table is needed.
 */
export const SCHEMA_VERSION = 1;

/**
 * Migrations are applied in order, starting after the database's current
 * `user_version`. Never edit a migration that has shipped; append a new one.
 */
const MIGRATIONS: readonly string[] = [
  // 1 — D-017/D-020: nightly resting heart rate for the D-009 L3 baseline.
  `CREATE TABLE IF NOT EXISTS rhr_nights (
     night_date  TEXT PRIMARY KEY NOT NULL,
     resting_bpm REAL NOT NULL
   );`,
];

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const current = row?.user_version ?? 0;

  for (let v = current; v < MIGRATIONS.length; v += 1) {
    await db.execAsync(MIGRATIONS[v]);
  }
  if (current < MIGRATIONS.length) {
    // PRAGMA does not accept bind parameters, and the value is a literal above.
    await db.execAsync(`PRAGMA user_version = ${MIGRATIONS.length};`);
  }
}

/** Open (once) and migrate the local database. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbPromise === null) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync('PRAGMA journal_mode = WAL;');
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}

/** Test seam; also used if a future settings screen needs to reopen the store. */
export function __resetDbForTests(): void {
  dbPromise = null;
}
