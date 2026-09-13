/**
 * Runtime guard on everything the app sends (D-010, AC-9, AC-3.4).
 *
 * Two independent rules, both absolute:
 *
 *  1. **Host.** Once a backend host is registered, requests to any other host are
 *     refused. There is exactly one place data may go.
 *  2. **Body.** No forbidden key, no ISO instant, no epoch-millisecond integer —
 *     ever, with no exemptions.
 *
 * Rule 2 has no allow-list on purpose (D-034). `computed_at` would have been the
 * first exemption, and the invariant is worth more than the convenience: "this
 * payload contains no timestamp" is checkable by inspection, while "contains no
 * timestamp except the permitted ones" is an argument. Clock skew is measured
 * instead with `device_clock_offset_min`, a plain integer count of minutes.
 */

/** Keys that may never appear in an outgoing body, at any depth. */
export const FORBIDDEN_KEYS: readonly string[] = [
  'startMs',
  'endMs',
  'atMs',
  'bpm',
  'startTime',
  'endTime',
  'startDate',
  'endDate',
  'sleep_start',
  'sleep_end',
  'sessions',
  'hr',
  'samples',
  'heartRate',
  'restingBpm',
  'resting_bpm',
  'rhrHistory',
  'bedTargetMin',
  'wakeTargetMin',
  'bedDevMin',
  'wakeDevMin',
  'computedAt',
  'computed_at',
];

/** ISO 8601 instants and epoch integers, in both common units, count as timestamps. */
const ISO_INSTANT = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const EPOCH_MS = /\b1[0-9]{12}\b/;
/**
 * DEF-005-03: epoch **seconds**, 10 digits. The guard knew only milliseconds, so
 * `Math.floor(Date.now() / 1000)` — the most ordinary way there is to shrink a
 * timestamp — walked straight through the check whose entire purpose is to stop
 * timestamps. A leak does not have to arrive in the unit the author happened to
 * think of.
 *
 * Safe against this payload's real integers: the §7 row carries minutes
 * (`deviation_min`, `device_clock_offset_min`), a small identity
 * (`commitment_id`) and booleans. None of them is ten digits beginning with 1.
 */
const EPOCH_SEC = /\b1[0-9]{9}\b/;

export class RawHealthLeakError extends Error {
  constructor(readonly detail: string) {
    super(`Refused to send raw health data: ${detail}`);
    this.name = 'RawHealthLeakError';
  }
}

export class ForbiddenHostError extends Error {
  constructor(readonly host: string) {
    super(`Refused to send to an unapproved host: ${host}`);
    this.name = 'ForbiddenHostError';
  }
}

let allowedOrigin: string | null = null;

/**
 * Register the one origin the app may talk to, from `EXPO_PUBLIC_SUPABASE_URL`.
 * Called once at startup. Until it is called, every request is refused.
 */
export function setAllowedOrigin(url: string): void {
  allowedOrigin = new URL(url).origin;
}

export function getAllowedOrigin(): string | null {
  return allowedOrigin;
}

/** Test seam. */
export function __resetAllowedOriginForTests(): void {
  allowedOrigin = null;
}

export function assertAllowedHost(input: string): void {
  let origin: string;
  try {
    origin = new URL(input).origin;
  } catch {
    throw new ForbiddenHostError(input);
  }
  if (allowedOrigin === null || origin !== allowedOrigin) {
    throw new ForbiddenHostError(origin);
  }
}

function walk(value: unknown, path: string, report: (d: string) => never): void {
  if (value === null || value === undefined) return;

  if (typeof value === 'string') {
    if (ISO_INSTANT.test(value)) report(`ISO timestamp at ${path}`);
    // Epoch integers must be looked for in text too, not only in numbers.
    // Found while testing DEF-005-03: `guardedFetch` falls back to scanning the
    // raw body when it is not JSON, and that fallback reached this branch, where
    // only the ISO pattern was applied. So a non-JSON body reading
    // `ts=1757206800000` passed the guard — a hole that predates the
    // epoch-seconds fix and would have swallowed milliseconds just as happily.
    if (EPOCH_MS.test(value)) report(`epoch-ms timestamp at ${path}`);
    if (EPOCH_SEC.test(value)) report(`epoch-seconds timestamp at ${path}`);
    return;
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      const text = String(value);
      if (EPOCH_MS.test(text)) report(`epoch-ms timestamp at ${path}`);
      if (EPOCH_SEC.test(text)) report(`epoch-seconds timestamp at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, report));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.includes(k)) report(`forbidden key "${k}" at ${path}`);
      walk(v, path ? `${path}.${k}` : k, report);
    }
  }
}

/** Throws `RawHealthLeakError` if `body` carries anything raw. */
export function assertNoRawHealth(body: unknown, path = ''): void {
  walk(body, path, (detail) => {
    throw new RawHealthLeakError(detail);
  });
}

/**
 * The `fetch` the Supabase client is given, and the only one application code
 * should use. Checks host and body before anything leaves.
 *
 * Note it inspects the *serialised* body Supabase produces, not a hand-built
 * object — so it guards what actually goes out, including anything a library
 * might add on the way.
 */
export const guardedFetch: typeof fetch = async (input, init) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;

  assertAllowedHost(url);

  const body = init?.body;
  if (typeof body === 'string' && body.length > 0) {
    try {
      assertNoRawHealth(JSON.parse(body) as unknown);
    } catch (e) {
      if (e instanceof RawHealthLeakError) throw e;
      // Not JSON (multipart, plain text): scan the raw text instead of skipping.
      assertNoRawHealth(body);
    }
  } else if (body !== undefined && body !== null && typeof body !== 'string') {
    // Anything non-string is not something this app should be sending.
    throw new RawHealthLeakError('non-string request body');
  }

  return fetch(input, init);
};
