/**
 * Nightly resting-heart-rate history, kept on the device (D-010, D-017, D-020).
 *
 * D-017's fallback path needs somewhere durable to keep the derived value: the
 * 10th-percentile figure is computed from a night's HR samples, those samples are
 * purged at 45 days, and the L3 baseline needs 30 nights of RHR. So this history
 * keeps its own 45-night window rather than riding the raw-sample purge.
 *
 * D-020: the durable implementation is `SqliteRhrHistoryStore` in ./sqliteRhrStore,
 * backed by the one `expo-sqlite` database. It lives in a separate module so that
 * this one stays pure and importable from Node tests without native modules.
 * `InMemoryRhrHistoryStore` below is for tests only and must not appear in a
 * production path.
 */
import type { RhrNight } from '../derive/types';

/** L3 needs a 30-night baseline; keep a little slack for gaps. */
export const RHR_HISTORY_DAYS = 45;

export interface RhrHistoryStore {
  /** Oldest first, newest last, at most `RHR_HISTORY_DAYS` entries. */
  load(): Promise<RhrNight[]>;
  /** Upsert one night. Re-deriving the same night overwrites it. */
  put(night: RhrNight): Promise<void>;
}

/**
 * Merge a night into a history list: newest-last, one entry per date, trimmed to
 * the retention window. Pure, so the policy is testable without a database — and
 * it is the same policy the SQL below enforces.
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
 * TEST ONLY (D-020). Loses everything on restart, so an L3 baseline can never
 * accumulate behind it — never wire this into a production path.
 */
export class InMemoryRhrHistoryStore implements RhrHistoryStore {
  private history: RhrNight[];

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
