/**
 * T-001 constraint: raw sessions must not linger in the app sandbox beyond 45 days.
 */
import { describe, expect, it } from 'vitest';
import { isExpired, LOCAL_RETENTION_DAYS, purgeExpired } from '../app/src/storage/purge';

const NOW = Date.parse('2026-09-07T06:00:00Z');
const DAY = 24 * 60 * 60_000;

describe('local retention', () => {
  it('keeps the horizon at 45 days', () => {
    expect(LOCAL_RETENTION_DAYS).toBe(45);
  });

  it('drops records older than the horizon and keeps the rest', () => {
    const records = [
      { atMs: NOW - 1 * DAY, id: 'yesterday' },
      { atMs: NOW - 44 * DAY, id: 'just-inside' },
      { atMs: NOW - 46 * DAY, id: 'just-outside' },
      { atMs: NOW - 400 * DAY, id: 'ancient' },
    ];
    expect(purgeExpired(records, NOW).map((r) => r.id)).toEqual(['yesterday', 'just-inside']);
  });

  it('treats the horizon itself as still retained', () => {
    expect(isExpired(NOW - 45 * DAY, NOW)).toBe(false);
    expect(isExpired(NOW - 45 * DAY - 1, NOW)).toBe(true);
  });

  it('is a no-op on an empty store', () => {
    expect(purgeExpired([], NOW)).toEqual([]);
  });
});
