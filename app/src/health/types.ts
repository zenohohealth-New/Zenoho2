/**
 * The one interface every platform must satisfy (T-001 deliverable 2).
 *
 * D-010: implementations return raw values to the *caller in this process only*.
 * Nothing here is serialisable to a network layer by design — see src/net.
 */
import type { HrSample, RhrNight, SleepSession } from '../derive/types';

export interface NightReadResult {
  readonly sessions: SleepSession[];
  readonly hr: HrSample[];
}

export type PermissionOutcome = 'GRANTED' | 'DENIED' | 'UNAVAILABLE';

export interface HealthStore {
  readonly platform: 'android' | 'ios';
  /** True when the underlying health store exists and is usable on this device. */
  isAvailable(): Promise<boolean>;
  /** Request read-only access to sleep + heart rate. Never requests write scopes. */
  requestReadPermissions(): Promise<PermissionOutcome>;
  /** True when background delivery/read is actually granted on this device. */
  hasBackgroundAccess(): Promise<boolean>;
  /**
   * Read the sessions and HR relevant to `nightDate` (spec §5 reads ~48h).
   * `tzOffsetMin` is the local UTC offset in minutes for that night.
   */
  readNight(nightDate: string, tzOffsetMin: number): Promise<NightReadResult>;

  /**
   * D-017: nightly resting heart rate for the last `days`, newest-last, for the
   * D-009 L3 coherence check. Returns an empty array when the store exposes no
   * resting-heart-rate record; the caller then falls back to `deriveNightlyRhr`.
   *
   * D-010: these values are for on-device comparison only and are never uploaded.
   */
  readRhrHistory(days: number, tzOffsetMin: number): Promise<RhrNight[]>;
}
