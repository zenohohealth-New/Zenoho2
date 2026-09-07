/**
 * Wear presence (spec §4, D-009 L2):
 * ">= 1 heart-rate sample per 30-minute bucket for >= 70% of buckets inside the
 * main sleep session".
 *
 * Buckets tile the session from its start; a trailing partial bucket counts as a
 * full bucket, because a 20-minute tail with no HR is still 20 minutes unproven.
 */
import { MIN_MS } from './time';
import type { HrSample } from './types';

export const BUCKET_MIN = 30;
export const WEAR_PRESENCE_THRESHOLD = 0.7;

export interface WearPresence {
  readonly ratio: number;
  readonly bucketsTotal: number;
  readonly bucketsCovered: number;
  readonly present: boolean;
}

export function wearPresence(
  hr: readonly HrSample[],
  startMs: number,
  endMs: number,
  /** When set, only HR from this source counts. */
  sourceId?: string,
): WearPresence {
  const bucketMs = BUCKET_MIN * MIN_MS;
  const durationMs = Math.max(0, endMs - startMs);
  const bucketsTotal = Math.ceil(durationMs / bucketMs);

  if (bucketsTotal === 0) {
    return { ratio: 0, bucketsTotal: 0, bucketsCovered: 0, present: false };
  }

  const covered = new Set<number>();
  for (const sample of hr) {
    if (sample.atMs < startMs || sample.atMs >= endMs) continue;
    if (sourceId !== undefined && sample.sourceId !== sourceId) continue;
    covered.add(Math.floor((sample.atMs - startMs) / bucketMs));
  }

  const ratio = covered.size / bucketsTotal;
  return {
    ratio,
    bucketsTotal,
    bucketsCovered: covered.size,
    present: ratio >= WEAR_PRESENCE_THRESHOLD,
  };
}
