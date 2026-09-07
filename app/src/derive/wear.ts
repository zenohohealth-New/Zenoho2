/**
 * Wear presence (spec §4, D-009 L2):
 * ">= 1 heart-rate sample per 30-minute bucket for >= 70% of buckets inside the
 * main sleep session".
 *
 * Buckets tile the session from its start; a trailing partial bucket counts as a
 * full bucket, because a 20-minute tail with no HR is still 20 minutes unproven.
 *
 * D-019: a sample only counts if `acceptSource` approves its provenance. HR from
 * a phone or a manual entry must not be able to satisfy L2 — otherwise the
 * wear-time check could be passed without wearing anything.
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
  /** Samples dropped because their source was not an acceptable wearable. */
  readonly samplesRejected: number;
}

/**
 * Decides whether one HR sample's provenance may count towards wear time.
 * Any allow-listed wearable qualifies — not only the app that wrote the sleep
 * session, since a watch writing sleep while a strap writes HR still proves wear.
 */
export type AcceptSource = (sample: HrSample) => boolean;

export function wearPresence(
  hr: readonly HrSample[],
  startMs: number,
  endMs: number,
  acceptSource?: AcceptSource,
): WearPresence {
  const bucketMs = BUCKET_MIN * MIN_MS;
  const durationMs = Math.max(0, endMs - startMs);
  const bucketsTotal = Math.ceil(durationMs / bucketMs);

  if (bucketsTotal === 0) {
    return {
      ratio: 0,
      bucketsTotal: 0,
      bucketsCovered: 0,
      present: false,
      samplesRejected: 0,
    };
  }

  const covered = new Set<number>();
  let samplesRejected = 0;

  for (const sample of hr) {
    if (sample.atMs < startMs || sample.atMs >= endMs) continue;
    if (acceptSource !== undefined && !acceptSource(sample)) {
      samplesRejected += 1;
      continue;
    }
    covered.add(Math.floor((sample.atMs - startMs) / bucketMs));
  }

  const ratio = covered.size / bucketsTotal;
  return {
    ratio,
    bucketsTotal,
    bucketsCovered: covered.size,
    present: ratio >= WEAR_PRESENCE_THRESHOLD,
    samplesRejected,
  };
}
