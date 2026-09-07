/**
 * L3 coherence (spec §5, D-009 L3):
 * "if 7-day median RHR deviates > 12 bpm from 30-day baseline (needs >= 14
 * baseline nights) -> integrity = UNVERIFIED".
 *
 * Flag only, member-visible only. RHR values never leave the device (D-010).
 */
import { median } from './time';
import type { RhrNight } from './types';

export const RHR_DEVIATION_BPM = 12;
export const RHR_MIN_BASELINE_NIGHTS = 14;
export const RHR_RECENT_NIGHTS = 7;
export const RHR_BASELINE_NIGHTS = 30;

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
