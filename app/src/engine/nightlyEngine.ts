/**
 * The local nightly engine (T-002).
 *
 * Reads the health store, derives a state on device, applies the §5 revision and
 * freeze rules against whatever is already stored, and persists the result. No
 * network, no account, no server — D-010 by construction, since there is no
 * upload path in this build at all.
 */
import {
  applyRevision,
  cycleStreak,
  deriveDailyState,
  localDateKey,
  selectMainSession,
  shouldPromptDeviceCheck,
  type DailyStateValue,
  type DerivedNight,
} from '../derive';
import type { Commitment } from '../derive/types';
import type { HealthStore } from '../health/types';
import { loadRhrHistory } from '../health/rhrHistory';
import type { RhrHistoryStore } from '../storage/rhrStore';
import {
  loadNight,
  putNight,
  loadAllNights,
  purgeOldStates,
} from '../storage/dailyStateStore';

/** Spec §12: Health Connect keeps 30 days by default; that bounds the backfill. */
export const BACKFILL_NIGHTS = 30;

export interface DeriveNightOptions {
  readonly store: HealthStore;
  readonly rhrLocalStore: RhrHistoryStore;
  readonly commitmentId: number;
  readonly commitment: Commitment;
  readonly nightDate: string;
  readonly tzOffsetMin: number;
  readonly prevTzOffsetMin?: number;
  readonly nowMs: number;
  /** AC-2.4 diagnostic: force the D-017 fallback so SQLite is written. */
  readonly forceRhrFallback?: boolean;
}

export interface DeriveNightOutcome {
  readonly nightDate: string;
  /** The row now in the database. */
  readonly stored: DerivedNight;
  /** What the fresh read derived, before the revision rules were applied. */
  readonly fresh: DerivedNight;
  /** True when an existing row was left alone because it was frozen or spent. */
  readonly keptExisting: boolean;
  /** Non-empty when a read failed; the night is then NOT a trustworthy NO_DATA. */
  readonly readErrors: readonly { kind: string; message: string }[];
  readonly usedRhrFallback: boolean;
}

/**
 * Derive one night and persist it.
 *
 * Returns without writing when a read failed and there is no existing row: an
 * empty read is not evidence of a quiet night (R-001 §12), and persisting NO_DATA
 * on the strength of a failed read would fabricate a miss.
 */
export async function deriveAndStoreNight(
  o: DeriveNightOptions,
): Promise<DeriveNightOutcome | null> {
  const { sessions, hr, readErrors } = await o.store.readNight(
    o.nightDate,
    o.tzOffsetMin,
  );

  const main = selectMainSession(sessions, o.nightDate, o.tzOffsetMin, o.store.platform);
  const rhr = await loadRhrHistory(
    o.store,
    o.rhrLocalStore,
    o.nightDate,
    o.tzOffsetMin,
    hr,
    main?.session.startMs ?? null,
    main?.session.endMs ?? null,
    undefined,
    o.forceRhrFallback ?? false,
  );

  const existing = await loadNight(o.commitmentId, o.nightDate);

  // A failed sleep read cannot be told apart from a quiet night by looking at the
  // data, so refuse to invent a state from it.
  const sleepReadFailed = readErrors.some((e) => e.kind === 'sleep');
  if (sleepReadFailed && existing === null) {
    return null;
  }

  const { night: fresh } = deriveDailyState(
    {
      nightDate: o.nightDate,
      commitment: o.commitment,
      sessions,
      hr,
      tzOffsetMin: o.tzOffsetMin,
      prevTzOffsetMin: o.prevTzOffsetMin,
      rhrHistory: rhr.history,
    },
    o.store.platform,
    o.nowMs,
  );

  const stored =
    existing === null
      ? fresh
      : applyRevision(existing, fresh, o.nowMs, o.tzOffsetMin);

  await putNight(o.commitmentId, stored);

  return {
    nightDate: o.nightDate,
    stored,
    fresh,
    keptExisting: existing !== null && stored.computedAt === existing.computedAt,
    readErrors,
    usedRhrFallback: rhr.usedFallback,
  };
}

export interface BackfillResult {
  readonly attempted: number;
  readonly stored: number;
  readonly skipped: number;
  readonly distribution: Record<DailyStateValue, number>;
  readonly purged: number;
}

/**
 * Derive and store the `nights` nights BEFORE today, oldest first.
 *
 * Today is deliberately excluded: the caller derives it separately, so the §5
 * revision and freeze rules apply to it normally. Including it here would consume
 * the single allowed revision on first run, for nothing.
 *
 * Oldest-first matters: the D-017 fallback accumulates RHR as it goes, so a later
 * night can see the baseline built by earlier ones.
 */
export async function backfill(
  o: Omit<DeriveNightOptions, 'nightDate' | 'prevTzOffsetMin'>,
  nights: number = BACKFILL_NIGHTS,
): Promise<BackfillResult> {
  const distribution: Record<DailyStateValue, number> = {
    KEPT: 0,
    MISSED: 0,
    NO_DATA: 0,
    TRAVEL: 0,
  };
  let stored = 0;
  let skipped = 0;

  for (let i = nights; i >= 1; i -= 1) {
    const nightDate = localDateKey(o.nowMs - i * 86_400_000, o.tzOffsetMin);
    const outcome = await deriveAndStoreNight({ ...o, nightDate });
    if (outcome === null) {
      skipped += 1;
      continue;
    }
    stored += 1;
    distribution[outcome.stored.state] += 1;
  }

  const purged = await purgeOldStates(o.nowMs);
  return { attempted: nights, stored, skipped, distribution, purged };
}

export interface HistorySummary {
  readonly nights: readonly DerivedNight[];
  /** Consecutive KEPT ending at the latest night (spec §5 streak rules). */
  readonly streak: number;
  /** Lifetime KEPT count across everything stored (spec §6). */
  readonly lifetimeKept: number;
  /** Spec §5: three NO_DATA nights in a row prompt a device check. */
  readonly promptDeviceCheck: boolean;
}

/**
 * Counters for the history screen.
 *
 * T-002 has no cycles (they arrive in T-004), so "cycle streak" has nothing to
 * reset against. Read here as: the streak over everything stored, using the same
 * §5 rules — KEPT counts, MISSED resets, NO_DATA and TRAVEL do neither.
 */
export async function summariseHistory(
  commitmentId: number,
): Promise<HistorySummary> {
  const nights = await loadAllNights(commitmentId);
  const states = nights.map((n) => n.state);
  return {
    nights,
    streak: cycleStreak(states),
    lifetimeKept: states.filter((s) => s === 'KEPT').length,
    promptDeviceCheck: shouldPromptDeviceCheck(states),
  };
}
