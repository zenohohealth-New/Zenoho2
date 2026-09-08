/**
 * A tiny key/value table in the one on-device database (D-020).
 *
 * Exists so the app can remember operational facts across restarts — chiefly
 * when the morning trigger was last scheduled and when it last actually fired.
 * Without that, a silent morning is indistinguishable from a morning where
 * nothing was ever scheduled, which is exactly the ambiguity that made AC-2.7's
 * failure hard to diagnose.
 *
 * D-010: bookkeeping only. No health data goes in here, and nothing is uploaded.
 */
import { getDb } from './db';

export const KEY_MORNING_NEXT_AT = 'morning_sync.next_at';
export const KEY_MORNING_LAST_FIRED = 'morning_sync.last_fired';
export const KEY_MORNING_LAST_SCHEDULED = 'morning_sync.last_scheduled';

export async function kvGet(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_kv WHERE key = ?;',
    [key],
  );
  return row?.value ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO app_kv (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [key, value],
  );
}

export async function kvGetNumber(key: string): Promise<number | null> {
  const raw = await kvGet(key);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function kvSetNumber(key: string, value: number): Promise<void> {
  await kvSet(key, String(value));
}
