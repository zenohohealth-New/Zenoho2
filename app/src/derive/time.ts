/**
 * Local-time helpers. Deliberately dependency-free: a night is described by an
 * explicit UTC offset, so no timezone database is needed and the module stays pure.
 */

export const MIN_MS = 60_000;
export const DAY_MIN = 1440;

/** Local minute-of-day (0..1439) for an epoch timestamp at a given UTC offset. */
export function localMinuteOfDay(epochMs: number, tzOffsetMin: number): number {
  const totalMin = Math.floor(epochMs / MIN_MS) + tzOffsetMin;
  return ((totalMin % DAY_MIN) + DAY_MIN) % DAY_MIN;
}

/** Local calendar day as `YYYY-MM-DD` for an epoch timestamp at a given UTC offset. */
export function localDateKey(epochMs: number, tzOffsetMin: number): string {
  const shifted = new Date(epochMs + tzOffsetMin * MIN_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Epoch ms of local midnight starting the given `YYYY-MM-DD` at a UTC offset. */
export function localMidnightMs(dateKey: string, tzOffsetMin: number): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - tzOffsetMin * MIN_MS;
}

/**
 * Signed difference between two minute-of-day values on a 24h circle,
 * in (-720, 720]. Keeps "23:50 vs 00:10" at +20 rather than -1420.
 */
export function circularDiffMin(a: number, b: number): number {
  const raw = ((a - b) % DAY_MIN + DAY_MIN) % DAY_MIN;
  return raw > DAY_MIN / 2 ? raw - DAY_MIN : raw;
}

/** Round to the nearest multiple of 5 (spec §5 `deviation_min`). */
export function roundTo5(n: number): number {
  return Math.round(n / 5) * 5;
}

/** Parse `HH:MM` into a local minute-of-day. Throws on malformed input. */
export function parseHhMm(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Invalid HH:MM time: ${hhmm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Invalid HH:MM time: ${hhmm}`);
  return h * 60 + min;
}

/** Median of a numeric list. Returns null for an empty list. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
