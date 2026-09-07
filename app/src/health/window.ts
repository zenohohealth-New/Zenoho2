import { localMidnightMs, MIN_MS } from '../derive/time';

/**
 * Read window for a night: spec §5 asks for "the last 48h" of records. Anchored
 * on the night date so the same window is used on device and in fixtures.
 */
export function nightReadWindow(nightDate: string, tzOffsetMin: number) {
  const midnight = localMidnightMs(nightDate, tzOffsetMin);
  return {
    startMs: midnight - 36 * 60 * MIN_MS, // 12:00 two days before the wake day
    endMs: midnight + 12 * 60 * MIN_MS, // 12:00 on the wake day
  };
}

export const toIso = (ms: number): string => new Date(ms).toISOString();
