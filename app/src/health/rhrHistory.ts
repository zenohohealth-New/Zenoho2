/**
 * D-017: assemble the RHR history the L3 coherence check needs.
 *
 * Preference order:
 *   1. the health store's own resting-heart-rate records, when it has any;
 *   2. otherwise a value derived on device as the 10th percentile of the
 *      night's sleep-window heart rate, persisted locally and never uploaded.
 *
 * D-010: nothing here crosses the network. The derived value is stored so the
 * 30-night baseline outlives the 45-day raw-sample purge.
 */
import { deriveNightlyRhr } from '../derive/rhr';
import type { HrSample, RhrNight } from '../derive/types';
import type { RhrHistoryStore } from '../storage/rhrStore';
import { RHR_HISTORY_DAYS } from '../storage/rhrStore';
import type { HealthStore } from './types';

export interface RhrHistoryResult {
  readonly history: RhrNight[];
  /** True when the value came from the fallback rather than the store. */
  readonly usedFallback: boolean;
}

/**
 * Read the store's RHR history; if it has none, derive tonight's value from the
 * sleep window, persist it, and return the locally accumulated history instead.
 *
 * `sleepStartMs`/`sleepEndMs` are the main session's bounds; pass null when the
 * night produced no main session, in which case no fallback value is derivable.
 */
export async function loadRhrHistory(
  store: HealthStore,
  localStore: RhrHistoryStore,
  nightDate: string,
  tzOffsetMin: number,
  hr: readonly HrSample[],
  sleepStartMs: number | null,
  sleepEndMs: number | null,
  acceptSample?: (sample: HrSample) => boolean,
): Promise<RhrHistoryResult> {
  const fromStore = await store.readRhrHistory(RHR_HISTORY_DAYS, tzOffsetMin);
  if (fromStore.length > 0) {
    return { history: fromStore, usedFallback: false };
  }

  if (sleepStartMs !== null && sleepEndMs !== null) {
    const restingBpm = deriveNightlyRhr(hr, sleepStartMs, sleepEndMs, acceptSample);
    if (restingBpm !== null) {
      await localStore.put({ nightDate, restingBpm });
    }
  }

  return { history: await localStore.load(), usedFallback: true };
}
