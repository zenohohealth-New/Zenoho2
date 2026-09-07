/**
 * Android bridge — Health Connect (D-011, spec §12).
 *
 * A thin adapter: permissions and SDK lifecycle live here, while the record
 * mapping and read isolation live in ./healthConnectMapping so they can be tested
 * in Node without the native module.
 *
 * Read-only: this file never imports or calls any Health Connect write API.
 */
import {
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';
import type { RhrNight } from '../derive/types';
import {
  readNightRecords,
  readRhrRecords,
  type ReadRecordsFn,
} from './healthConnectMapping';
import type { HealthStore, NightReadResult, PermissionOutcome } from './types';

const READ_PERMISSIONS = [
  { accessType: 'read', recordType: 'SleepSession' },
  { accessType: 'read', recordType: 'HeartRate' },
  // D-017: resting heart rate feeds the D-009 L3 coherence check, on device only.
  // Needs android.permission.health.READ_RESTING_HEART_RATE in the manifest, or
  // the read throws SecurityException (observed on the S26 Ultra, 2026-09-07).
  { accessType: 'read', recordType: 'RestingHeartRate' },
] as const;

/** Spec §12 / D-011: background + history are requested alongside the reads. */
const SPECIAL_PERMISSIONS = [
  { accessType: 'read', recordType: 'BackgroundAccessPermission' },
  { accessType: 'read', recordType: 'ReadHealthDataHistory' },
] as const;

export class HealthConnectStore implements HealthStore {
  readonly platform = 'android' as const;

  private initialized = false;

  private async ensureInit(): Promise<boolean> {
    if (this.initialized) return true;
    const status = await getSdkStatus();
    if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) return false;
    this.initialized = await initialize();
    return this.initialized;
  }

  async isAvailable(): Promise<boolean> {
    return this.ensureInit();
  }

  async requestReadPermissions(): Promise<PermissionOutcome> {
    if (!(await this.ensureInit())) return 'UNAVAILABLE';
    const granted = await requestPermission([
      ...READ_PERMISSIONS,
      ...SPECIAL_PERMISSIONS,
    ] as never);
    const has = (recordType: string) =>
      granted.some(
        (p) => (p as { recordType?: string }).recordType === recordType,
      );
    // Sleep and HR are mandatory. Resting HR, background and history are not:
    // without RHR the L3 check falls back (D-017), which is not a reason to fail.
    return has('SleepSession') && has('HeartRate') ? 'GRANTED' : 'DENIED';
  }

  async hasBackgroundAccess(): Promise<boolean> {
    if (!(await this.ensureInit())) return false;
    const granted = await getGrantedPermissions();
    return granted.some(
      (p) =>
        (p as { recordType?: string }).recordType === 'BackgroundAccessPermission',
    );
  }

  async readNight(nightDate: string, tzOffsetMin: number): Promise<NightReadResult> {
    if (!(await this.ensureInit())) {
      return {
        sessions: [],
        hr: [],
        readErrors: [{ kind: 'sleep', message: 'Health Connect is unavailable' }],
      };
    }
    return readNightRecords(readRecords as unknown as ReadRecordsFn, nightDate, tzOffsetMin);
  }

  async readRhrHistory(days: number, tzOffsetMin: number): Promise<RhrNight[]> {
    if (!(await this.ensureInit())) return [];
    return readRhrRecords(readRecords as unknown as ReadRecordsFn, days, tzOffsetMin);
  }
}
