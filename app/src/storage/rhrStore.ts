/**
 * Nightly resting-heart-rate history, kept on the device (D-010, D-017).
 *
 * D-017's fallback path needs somewhere to keep the derived value, because the
 * 10th-percentile figure is computed from a night's HR samples and those samples
 * are purged at 45 days — while the L3 baseline needs 30 nights of RHR.
 *
 * The durable engine is deliberately NOT chosen here. No decision covers local
 * persistence yet, and picking AsyncStorage / expo-sqlite / expo-file-system
 * unilaterally would be inventing one. This module fixes the shape and the
 * retention rule; T-002 supplies a `RhrHistoryStore` that survives a restart.
 * See R-001 §6.
 */
import type { RhrNight } from '../derive/types';

/** L3 needs a 30-night baseline; keep a little slack for gaps. */
export const RHR_HISTORY_DAYS = 45;

export interface RhrHistoryStore {
  /** Newest-last, oldest first, at most `RHR_HISTORY_DAYS` entries. */
  load(): Promise<RhrNight[]>;
  /** Upsert one night. Re-deriving the same night overwrites it. */
  put(night: RhrNight): Promise<void>;
}

/**
 * Merge a night into a history list: newest-last, one entry per date, trimmed to
 * the retention window. Pure, so the policy is testable without an engine.
 */
export function mergeRhrNight(
  history: readonly RhrNight[],
  night: RhrNight,
  keepDays: number = RHR_HISTORY_DAYS,
): RhrNight[] {
  const byDate = new Map(history.map((n) => [n.nightDate, n]));
  byDate.set(night.nightDate, night);
  return [...byDate.values()]
    .sort((a, b) => (a.nightDate < b.nightDate ? -1 : 1))
    .slice(-keepDays);
}

/**
 * In-memory implementation. Correct for a single app session and used by tests;
 * it loses everything on restart, which is exactly why T-002 must replace it.
 */
export class InMemoryRhrHistoryStore implements RhrHistoryStore {
  private history: RhrNight[] = [];

  constructor(seed: readonly RhrNight[] = []) {
    this.history = [...seed];
  }

  async load(): Promise<RhrNight[]> {
    return [...this.history];
  }

  async put(night: RhrNight): Promise<void> {
    this.history = mergeRhrNight(this.history, night);
  }
}
