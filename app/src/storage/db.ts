/**
 * The single on-device database (D-020).
 *
 * `expo-sqlite` holds everything Zenoho keeps locally: resting-heart-rate history,
 * the commitment, and the nightly states. One store rather than several keeps the
 * retention rules auditable in one place.
 *
 * D-010: nothing in this database is ever uploaded. It exists precisely so that
 * derivation can happen on the phone.
 */
import * as SQLite from 'expo-sqlite';

export const DB_NAME = 'zenoho.db';

/**
 * Migrations are applied in order, starting after the database's current
 * `user_version` (SQLite's own pragma, so no bookkeeping table is needed).
 * Never edit a migration that has shipped; append a new one.
 */
const MIGRATIONS: readonly string[] = [
  // 1 — D-017/D-020: nightly resting heart rate for the D-009 L3 baseline.
  `CREATE TABLE IF NOT EXISTS rhr_nights (
     night_date  TEXT PRIMARY KEY NOT NULL,
     resting_bpm REAL NOT NULL
   );`,

  // 2 — T-002: the commitment and the nightly states.
  //
  // `daily_states` mirrors the spec §8 column list, minus the server-only
  // `id`/`computed_at` surrogate concerns and plus `revision_count`, which §8 has
  // no column for because it never crosses the wire (D-010). One row per
  // (commitment, night) is enforced by the primary key rather than by app code.
  `CREATE TABLE IF NOT EXISTS commitments (
     id             INTEGER PRIMARY KEY AUTOINCREMENT,
     bed_target_min INTEGER NOT NULL,
     wake_target_min INTEGER NOT NULL,
     tolerance_min  INTEGER NOT NULL,
     created_at     INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS daily_states (
     commitment_id INTEGER NOT NULL,
     night_date    TEXT NOT NULL,
     state         TEXT NOT NULL,
     integrity     TEXT NOT NULL,
     source_id     TEXT,
     wear_presence INTEGER NOT NULL,
     deviation_min INTEGER,
     computed_at   INTEGER NOT NULL,
     frozen        INTEGER NOT NULL,
     revision_count INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (commitment_id, night_date)
   );
   CREATE INDEX IF NOT EXISTS idx_daily_states_night
     ON daily_states (night_date DESC);`,

  // 3 — operational bookkeeping. Chiefly the morning trigger: when it was last
  // scheduled, when it is next expected, and when it last actually fired. Without
  // this, a silent morning cannot be told apart from one where nothing was ever
  // scheduled — the ambiguity that made AC-2.7's failure hard to diagnose.
  `CREATE TABLE IF NOT EXISTS app_kv (
     key   TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   );`,

  // 4 — T-003 sync queue. A night is enqueued when it is derived and removed once
  // the server has it, so a derivation made offline is not lost (AC-3.6). Holds
  // only the spec §7 payload: no raw health data reaches this table either.
  `CREATE TABLE IF NOT EXISTS sync_queue (
     night_date  TEXT PRIMARY KEY NOT NULL,
     payload     TEXT NOT NULL,
     queued_at   INTEGER NOT NULL,
     attempts    INTEGER NOT NULL DEFAULT 0,
     last_error  TEXT
   );`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const current = row?.user_version ?? 0;

  for (let v = current; v < MIGRATIONS.length; v += 1) {
    await db.execAsync(MIGRATIONS[v]);
  }
  if (current < MIGRATIONS.length) {
    // PRAGMA takes no bind parameters, and the value is a literal length above.
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

/** Test seam; also used if a settings screen ever needs to reopen the store. */
export function __resetDbForTests(): void {
  dbPromise = null;
}
