/**
 * L3 coherence (spec §5, D-009 L3):
 * "if 7-day median RHR deviates > 12 bpm from 30-day baseline (needs >= 14
 * baseline nights) -> integrity = UNVERIFIED".
 *
 * Flag only, member-visible only. RHR values never leave the device (D-010).
 */
import { median } from './time';
import type { HrSample, RhrNight } from './types';

export const RHR_DEVIATION_BPM = 12;
export const RHR_MIN_BASELINE_NIGHTS = 14;
export const RHR_RECENT_NIGHTS = 7;
export const RHR_BASELINE_NIGHTS = 30;

/** D-017 fallback: nightly RHR is the 10th percentile of sleep-window HR. */
export const RHR_FALLBACK_PERCENTILE = 0.1;

/** A fallback night needs enough samples for a percentile to mean anything. */
export const RHR_FALLBACK_MIN_SAMPLES = 10;

export interface CoherenceResult {
  /** False when there is not enough history; caller must not flag UNVERIFIED. */
  readonly evaluated: boolean;
  readonly drifted: boolean;
  readonly recentMedian: number | null;
  readonly baselineMedian: number | null;
}

/**
 * `history` is newest-last. Only nights strictly before `nightDate` form the
 * baseline, so a night is never judged against itself.
 */
export function rhrCoherence(
  history: readonly RhrNight[] | undefined,
  nightDate: string,
): CoherenceResult {
  const empty: CoherenceResult = {
    evaluated: false,
    drifted: false,
    recentMedian: null,
    baselineMedian: null,
  };
  if (!history || history.length === 0) return empty;

  const prior = history
    .filter((n) => n.nightDate < nightDate)
    .sort((a, b) => (a.nightDate < b.nightDate ? -1 : 1));

  const baselineWindow = prior.slice(-RHR_BASELINE_NIGHTS);
  if (baselineWindow.length < RHR_MIN_BASELINE_NIGHTS) return empty;

  const recentWindow = prior.slice(-RHR_RECENT_NIGHTS);
  const recentMedian = median(recentWindow.map((n) => n.restingBpm));
  const baselineMedian = median(baselineWindow.map((n) => n.restingBpm));
  if (recentMedian === null || baselineMedian === null) return empty;

  return {
    evaluated: true,
    drifted: Math.abs(recentMedian - baselineMedian) > RHR_DEVIATION_BPM,
    recentMedian,
    baselineMedian,
  };
}

/**
 * D-017 fallback for stores that expose no resting-heart-rate record: derive the
 * night's RHR as the 10th percentile of the heart rate inside the sleep window.
 *
 * Nearest-rank percentile on the sorted samples. Returns null when there are too
 * few samples to be meaningful — a guess here would feed a false integrity flag.
 * Like every RHR value, the result stays on the device (D-010).
 */
export function deriveNightlyRhr(
  hr: readonly HrSample[],
  startMs: number,
  endMs: number,
  acceptSample?: (sample: HrSample) => boolean,
): number | null {
  const inWindow = hr
    .filter((s) => s.atMs >= startMs && s.atMs < endMs)
    .filter((s) => (acceptSample === undefined ? true : acceptSample(s)))
    .map((s) => s.bpm)
    .sort((a, b) => a - b);

  if (inWindow.length < RHR_FALLBACK_MIN_SAMPLES) return null;

  const rank = Math.max(
    0,
    Math.ceil(RHR_FALLBACK_PERCENTILE * inWindow.length) - 1,
  );
  return inWindow[rank];
}
