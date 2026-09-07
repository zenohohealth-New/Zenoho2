/**
 * Runtime guard behind the upload boundary (D-010, AC-9).
 *
 * `toServerRow` already whitelists fields; this is the belt to that pair of
 * braces. It inspects an outgoing body and throws if anything in it looks like a
 * raw health value — a timestamp precise enough to be a sleep time, or a number
 * in heart-rate range sitting under a suspicious key.
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
  'sessions',
  'hr',
  'samples',
  'heartRate',
  'restingBpm',
  'rhrHistory',
  'bedTargetMin',
  'wakeTargetMin',
  'bedDevMin',
  'wakeDevMin',
];

/** ISO 8601 instants and epoch-millisecond integers both count as timestamps. */
const ISO_INSTANT = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const EPOCH_MS = /\b1[0-9]{12}\b/;

export class RawHealthLeakError extends Error {
  constructor(readonly detail: string) {
    super(`Refused to send raw health data: ${detail}`);
    this.name = 'RawHealthLeakError';
  }
}

function walk(value: unknown, path: string, report: (d: string) => never): void {
  if (value === null || value === undefined) return;

  if (typeof value === 'string') {
    if (ISO_INSTANT.test(value)) report(`ISO timestamp at ${path}`);
    return;
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value) && EPOCH_MS.test(String(value))) {
      report(`epoch-ms timestamp at ${path}`);
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
 * `fetch` with the guard welded on. Application code must use this; calling the
 * global `fetch` directly for health data is the bug this exists to prevent.
 */
export async function guardedFetch(
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: unknown },
): Promise<Response> {
  if (init?.body !== undefined) assertNoRawHealth(init.body);
  return fetch(input, {
    ...init,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  } as RequestInit);
}
