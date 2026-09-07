/**
 * The one interface every platform must satisfy (T-001 deliverable 2).
 *
 * D-010: implementations return raw values to the *caller in this process only*.
 * Nothing here is serialisable to a network layer by design — see src/net.
 */
import type { HrSample, SleepSession } from '../derive/types';

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
}
