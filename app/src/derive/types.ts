/**
 * Wire types for on-device derivation (spec §4, §5).
 *
 * D-010: every value in this file lives and dies on the phone. Only `DerivedNight`
 * is ever eligible to reach a server, and only the fields listed in spec §7.
 */

/** How the platform says the record was produced. */
export type RecordingMethod = 'AUTOMATIC' | 'MANUAL' | 'UNKNOWN';

/**
 * One sleep session as read from Health Connect / HealthKit, with provenance
 * preserved verbatim (D-009 L1 needs the origin string, not a boolean).
 */
export interface SleepSession {
  /** Origin package (Android) or sourceRevision bundle id (iOS), unmodified. */
  readonly sourceId: string;
  /** Epoch milliseconds, inclusive. */
  readonly startMs: number;
  /** Epoch milliseconds, exclusive. */
  readonly endMs: number;
  readonly recordingMethod: RecordingMethod;
}

/**
 * One heart-rate sample. Used only for wear presence (D-009 L2) and RHR (L3).
 *
 * D-019: provenance is carried on HR too, because a phone-written or manually
 * entered heart rate must not be able to satisfy the wear-time check.
 */
export interface HrSample {
  readonly sourceId: string;
  readonly atMs: number;
  readonly bpm: number;
  readonly recordingMethod: RecordingMethod;
}

export type ToleranceMin = 15 | 30 | 45 | 60;

/** Spec §4: {bed_target, wake_target, tolerance_min ∈ {15,30,45,60}, default 30}. */
export interface Commitment {
  /** Local minute-of-day, 0..1439. */
  readonly bedTargetMin: number;
  /** Local minute-of-day, 0..1439. */
  readonly wakeTargetMin: number;
  readonly toleranceMin: ToleranceMin;
}

export const DEFAULT_TOLERANCE_MIN: ToleranceMin = 30;

export type DailyStateValue = 'KEPT' | 'MISSED' | 'NO_DATA' | 'TRAVEL';

export type IntegrityFlag =
  | 'OK'
  | 'UNVERIFIED'
  | 'NO_SOURCE'
  | 'NO_WEAR'
  | 'TRAVEL';

/**
 * Nightly resting-heart-rate history for the L3 coherence check (D-009).
 * Stays on device permanently; never uploaded (D-010).
 */
export interface RhrNight {
  /** Night date, `YYYY-MM-DD` local. */
  readonly nightDate: string;
  readonly restingBpm: number;
}

export interface DeriveInput {
  /** Night date = the calendar day the user woke (spec §4), `YYYY-MM-DD`. */
  readonly nightDate: string;
  readonly commitment: Commitment;
  /** Sleep sessions read for the ~48h around the night. */
  readonly sessions: readonly SleepSession[];
  /** Heart-rate samples read for the ~48h around the night. */
  readonly hr: readonly HrSample[];
  /** UTC offset in minutes for this night's local day (e.g. IST = 330). */
  readonly tzOffsetMin: number;
  /** UTC offset in minutes for the previous local day. Omit if unknown. */
  readonly prevTzOffsetMin?: number;
  /** Nightly RHR history, newest-last. Optional; L3 is skipped when too short. */
  readonly rhrHistory?: readonly RhrNight[];
}

/**
 * The ONLY shape allowed to leave the device (spec §7 server row).
 * Note what is absent: no timestamps, no bpm, no session ids beyond the source.
 */
export interface DerivedNight {
  readonly nightDate: string;
  readonly state: DailyStateValue;
  readonly integrity: IntegrityFlag;
  /** Origin package/bundle of the main session, or null when there was none. */
  readonly sourceId: string | null;
  readonly wearPresence: boolean;
  /** max(|bed_dev|, |wake_dev|) rounded to nearest 5. Null when no session. */
  readonly deviationMin: number | null;
  /** Epoch ms this row was computed. */
  readonly computedAt: number;
  readonly frozen: boolean;
  /** How many times this row has been revised (spec §5: at most one). */
  readonly revisionCount: number;
}
