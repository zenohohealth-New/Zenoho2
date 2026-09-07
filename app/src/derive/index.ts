/**
 * Daily state derivation — spec §5. Pure TypeScript: no platform imports, no I/O,
 * no clock of its own. Everything it needs arrives in `DeriveInput` (D-010: this
 * is the only place raw health values are ever touched, and they stay here).
 */
import {
  circularDiffMin,
  localMidnightMs,
  localMinuteOfDay,
  MIN_MS,
  roundTo5,
} from './time';
import { selectMainSession } from './session';
import { wearPresence } from './wear';
import { rhrCoherence } from './rhr';
import { classifySource, type Platform } from '../eligibility';
import type {
  DailyStateValue,
  DeriveInput,
  DerivedNight,
  HrSample,
  IntegrityFlag,
} from './types';

export * from './types';
export * from './time';
export * from './session';
export * from './wear';
export * from './rhr';

/** Spec §5: a timezone change larger than this in a day makes the night TRAVEL. */
export const TRAVEL_TZ_SHIFT_MIN = 180;

/** Spec §5: a state may be revised until 14:00 local, then it freezes. */
export const FREEZE_LOCAL_MINUTE = 14 * 60;

/**
 * The instant a night's state freezes: 14:00 local ON THAT NIGHT'S DATE.
 *
 * This has to be anchored to the night, not to the current time of day. Reading
 * only the clock would leave a night from last week revisable every morning and
 * frozen every afternoon, which is not what §5 says — and backfill (T-002) is
 * made entirely of such nights.
 */
export function freezeAtMs(nightDate: string, tzOffsetMin: number): number {
  return localMidnightMs(nightDate, tzOffsetMin) + FREEZE_LOCAL_MINUTE * MIN_MS;
}

/** Spec §5: 3 consecutive NO_DATA nights prompt the member to check their device. */
export const NO_DATA_PROMPT_RUN = 3;

/**
 * Everything the derivation worked out, including the parts that must never be
 * uploaded. `night` is the uploadable subset (spec §7).
 */
export interface DeriveResult {
  readonly night: DerivedNight;
  /** Signed bed deviation in minutes. Device-only; never uploaded. */
  readonly bedDevMin: number | null;
  /** Signed wake deviation in minutes. Device-only; never uploaded. */
  readonly wakeDevMin: number | null;
  readonly wearRatio: number;
}

function noDataResult(
  nightDate: string,
  integrity: IntegrityFlag,
  state: DailyStateValue,
  sourceId: string | null,
  computedAt: number,
  wearRatio: number,
): DeriveResult {
  return {
    night: {
      nightDate,
      state,
      integrity,
      sourceId,
      wearPresence: false,
      deviationMin: null,
      computedAt,
      frozen: false,
      revisionCount: 0,
    },
    bedDevMin: null,
    wakeDevMin: null,
    wearRatio,
  };
}

export function deriveDailyState(
  input: DeriveInput,
  platform: Platform,
  computedAt: number,
): DeriveResult {
  const { nightDate, commitment, sessions, hr, tzOffsetMin, prevTzOffsetMin } = input;

  // Spec §5: timezone jump is decided before anything else — the night's local
  // clock is not trustworthy enough to judge a bed/wake target against.
  if (
    prevTzOffsetMin !== undefined &&
    Math.abs(tzOffsetMin - prevTzOffsetMin) > TRAVEL_TZ_SHIFT_MIN
  ) {
    return noDataResult(nightDate, 'TRAVEL', 'TRAVEL', null, computedAt, 0);
  }

  const pick = selectMainSession(sessions, nightDate, tzOffsetMin, platform);
  if (pick === null) {
    return noDataResult(nightDate, 'NO_SOURCE', 'NO_DATA', null, computedAt, 0);
  }

  const { session, verdict } = pick;

  // D-019: only HR from a source that is not blocked may prove wear time, so a
  // phone-written or manually entered heart rate cannot satisfy L2. Unknown
  // brands still count, preserving §9's rule that a new brand is flagged rather
  // than silently excluded.
  const acceptHrSource = (sample: HrSample) =>
    classifySource(sample.sourceId, sample.recordingMethod, platform).sourceClass !==
    'BLOCKED';

  const wear = wearPresence(hr, session.startMs, session.endMs, acceptHrSource);
  if (!wear.present) {
    return noDataResult(nightDate, 'NO_WEAR', 'NO_DATA', session.sourceId, computedAt, wear.ratio);
  }

  const bedDevMin = circularDiffMin(
    localMinuteOfDay(session.startMs, tzOffsetMin),
    commitment.bedTargetMin,
  );
  const wakeDevMin = circularDiffMin(
    localMinuteOfDay(session.endMs, tzOffsetMin),
    commitment.wakeTargetMin,
  );

  const tol = commitment.toleranceMin;
  const state: DailyStateValue =
    Math.abs(bedDevMin) <= tol && Math.abs(wakeDevMin) <= tol ? 'KEPT' : 'MISSED';

  // integrity = OK, then L3 and the §9 unknown-brand rule may downgrade it.
  let integrity: IntegrityFlag = 'OK';
  if (verdict.brandUnverified) integrity = 'UNVERIFIED';
  const coherence = rhrCoherence(input.rhrHistory, nightDate);
  if (coherence.evaluated && coherence.drifted) integrity = 'UNVERIFIED';

  const deviationMin = roundTo5(Math.max(Math.abs(bedDevMin), Math.abs(wakeDevMin)));

  return {
    night: {
      nightDate,
      state,
      integrity,
      sourceId: session.sourceId,
      wearPresence: true,
      deviationMin,
      computedAt,
      frozen: false,
      revisionCount: 0,
    },
    bedDevMin,
    wakeDevMin,
    wearRatio: wear.ratio,
  };
}

/**
 * Spec §5: "A day's state may be revised once until 14:00 local (late syncs);
 * after that it is frozen."
 *
 * Returns the row to keep. A row is frozen once local 14:00 has passed, or once
 * it has already been revised once.
 */
export function applyRevision(
  existing: DerivedNight,
  fresh: DerivedNight,
  nowMs: number,
  tzOffsetMin: number,
): DerivedNight {
  const pastFreeze = nowMs >= freezeAtMs(existing.nightDate, tzOffsetMin);

  if (existing.frozen || existing.revisionCount >= 1) {
    return { ...existing, frozen: existing.frozen || pastFreeze };
  }
  if (pastFreeze) {
    // Too late to revise; freeze what is already there.
    return { ...existing, frozen: true };
  }
  return { ...fresh, frozen: false, revisionCount: existing.revisionCount + 1 };
}

/** Spec §5 streak rules: KEPT counts, MISSED resets, NO_DATA/TRAVEL do neither. */
export function cycleStreak(states: readonly DailyStateValue[]): number {
  let streak = 0;
  for (const s of states) {
    if (s === 'KEPT') streak += 1;
    else if (s === 'MISSED') streak = 0;
  }
  return streak;
}

/** Spec §5: 3 consecutive NO_DATA nights show a "device?" prompt to the member. */
export function shouldPromptDeviceCheck(states: readonly DailyStateValue[]): boolean {
  const tail = states.slice(-NO_DATA_PROMPT_RUN);
  return tail.length === NO_DATA_PROMPT_RUN && tail.every((s) => s === 'NO_DATA');
}
