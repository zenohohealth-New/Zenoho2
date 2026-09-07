/**
 * Android bridge — Health Connect (D-011, spec §12).
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
import { localDateKey } from '../derive/time';
import type {
  HrSample,
  RecordingMethod,
  RhrNight,
  SleepSession,
} from '../derive/types';
import type { HealthStore, NightReadResult, PermissionOutcome } from './types';
import { nightReadWindow, toIso } from './window';

const READ_PERMISSIONS = [
  { accessType: 'read', recordType: 'SleepSession' },
  { accessType: 'read', recordType: 'HeartRate' },
  // D-017: resting heart rate feeds the D-009 L3 coherence check, on device only.
  { accessType: 'read', recordType: 'RestingHeartRate' },
] as const;

/** Spec §12 / D-011: background + history are requested alongside the reads. */
const SPECIAL_PERMISSIONS = [
  { accessType: 'read', recordType: 'BackgroundAccessPermission' },
  { accessType: 'read', recordType: 'ReadHealthDataHistory' },
] as const;

/**
 * Health Connect `RecordingMethod` values, inlined rather than imported: the enum
 * lives behind a deep path in the package and importing it pulls native code into
 * the pure test environment.
 */
const HC_RECORDING_MANUAL = 3;
const HC_RECORDING_ACTIVE = 1;
const HC_RECORDING_AUTOMATIC = 2;

function mapRecordingMethod(m: number | undefined): RecordingMethod {
  switch (m) {
    case HC_RECORDING_MANUAL:
      return 'MANUAL';
    case HC_RECORDING_ACTIVE:
    case HC_RECORDING_AUTOMATIC:
      return 'AUTOMATIC';
    default:
      return 'UNKNOWN';
  }
}

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
    // Background/history are nice-to-have; sleep + HR are mandatory.
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
    if (!(await this.ensureInit())) return { sessions: [], hr: [] };

    const { startMs, endMs } = nightReadWindow(nightDate, tzOffsetMin);
    const timeRangeFilter = {
      operator: 'between' as const,
      startTime: toIso(startMs),
      endTime: toIso(endMs),
    };

    const sleep = await readRecords('SleepSession', { timeRangeFilter });
    const sessions: SleepSession[] = sleep.records.map((r) => ({
      // dataOrigin is the D-009 L1 evidence; keep it verbatim, never normalise.
      sourceId: r.metadata?.dataOrigin ?? '',
      startMs: Date.parse(r.startTime),
      endMs: Date.parse(r.endTime),
      recordingMethod: mapRecordingMethod(r.metadata?.recordingMethod),
    }));

    const heart = await readRecords('HeartRate', { timeRangeFilter });
    const hr: HrSample[] = [];
    for (const record of heart.records) {
      const sourceId = record.metadata?.dataOrigin ?? '';
      // D-019: provenance rides along on every sample so a phone-written or
      // manually entered heart rate cannot satisfy the wear-time check.
      const recordingMethod = mapRecordingMethod(record.metadata?.recordingMethod);
      for (const sample of record.samples) {
        hr.push({
          sourceId,
          atMs: Date.parse(sample.time),
          bpm: sample.beatsPerMinute,
          recordingMethod,
        });
      }
    }

    return { sessions, hr };
  }

  /** D-017: Health Connect exposes RestingHeartRate directly. */
  async readRhrHistory(days: number, tzOffsetMin: number): Promise<RhrNight[]> {
    if (!(await this.ensureInit())) return [];

    const endMs = Date.now();
    const startMs = endMs - days * 24 * 60 * 60_000;

    const result = await readRecords('RestingHeartRate', {
      timeRangeFilter: {
        operator: 'between',
        startTime: toIso(startMs),
        endTime: toIso(endMs),
      },
    });

    // One value per night: Health Connect may hold several, so keep the last.
    const byNight = new Map<string, number>();
    for (const record of result.records) {
      if (mapRecordingMethod(record.metadata?.recordingMethod) === 'MANUAL') continue;
      const atMs = Date.parse(record.time);
      byNight.set(localDateKey(atMs, tzOffsetMin), record.beatsPerMinute);
    }

    return [...byNight.entries()]
      .map(([nightDate, restingBpm]) => ({ nightDate, restingBpm }))
      .sort((a, b) => (a.nightDate < b.nightDate ? -1 : 1));
  }
}
