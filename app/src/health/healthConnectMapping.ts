/**
 * The Health Connect reading logic, separated from the native module.
 *
 * Everything here takes `readRecords` as an argument rather than importing it, so
 * the read isolation and the record mapping can be tested for real in Node — no
 * native module, no mock of one. `healthConnect.android.ts` is then a thin
 * adapter that supplies the genuine function.
 */
import { localDateKey } from '../derive/time';
import type {
  HrSample,
  RecordingMethod,
  RhrNight,
  SleepSession,
} from '../derive/types';
import type { NightReadResult, ReadIssue } from './types';
import { nightReadWindow, toIso } from './window';

/**
 * Health Connect `RecordingMethod` values, inlined rather than imported: the enum
 * lives behind a deep path in the package and importing it pulls native code in.
 */
const HC_RECORDING_ACTIVE = 1;
const HC_RECORDING_AUTOMATIC = 2;
const HC_RECORDING_MANUAL = 3;

export interface HcMetadata {
  dataOrigin?: string;
  recordingMethod?: number;
}

export interface HcSleepRecord {
  startTime: string;
  endTime: string;
  metadata?: HcMetadata;
}

export interface HcHeartRateRecord {
  metadata?: HcMetadata;
  samples: { time: string; beatsPerMinute: number }[];
}

export interface HcRestingHeartRateRecord {
  time: string;
  beatsPerMinute: number;
  metadata?: HcMetadata;
}

/** The shape of `readRecords` from react-native-health-connect, narrowed. */
export type ReadRecordsFn = (
  recordType: string,
  options: { timeRangeFilter: { operator: 'between'; startTime: string; endTime: string } },
) => Promise<{ records: unknown[] }>;

export function mapRecordingMethod(m: number | undefined): RecordingMethod {
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

/** Platform exceptions are opaque objects as often as they are Errors. */
export function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Read sleep and heart rate for a night, each independently.
 *
 * A permission or platform failure on one read must not blank the other, so both
 * are caught separately and reported in `readErrors`. Callers MUST check that
 * field: an empty `sessions` from a failed read is not the same fact as an empty
 * `sessions` from a quiet night, and must never be persisted as NO_DATA.
 */
export async function readNightRecords(
  readRecords: ReadRecordsFn,
  nightDate: string,
  tzOffsetMin: number,
): Promise<NightReadResult> {
  const { startMs, endMs } = nightReadWindow(nightDate, tzOffsetMin);
  const timeRangeFilter = {
    operator: 'between' as const,
    startTime: toIso(startMs),
    endTime: toIso(endMs),
  };
  const readErrors: ReadIssue[] = [];

  let sessions: SleepSession[] = [];
  try {
    const sleep = await readRecords('SleepSession', { timeRangeFilter });
    sessions = (sleep.records as HcSleepRecord[]).map((r) => ({
      // dataOrigin is the D-009 L1 evidence; keep it verbatim, never normalise.
      sourceId: r.metadata?.dataOrigin ?? '',
      startMs: Date.parse(r.startTime),
      endMs: Date.parse(r.endTime),
      recordingMethod: mapRecordingMethod(r.metadata?.recordingMethod),
    }));
  } catch (e) {
    readErrors.push({ kind: 'sleep', message: describe(e) });
  }

  const hr: HrSample[] = [];
  try {
    const heart = await readRecords('HeartRate', { timeRangeFilter });
    for (const record of heart.records as HcHeartRateRecord[]) {
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
  } catch (e) {
    readErrors.push({ kind: 'hr', message: describe(e) });
  }

  return { sessions, hr, readErrors };
}

/**
 * D-017: nightly resting heart rate.
 *
 * Returns [] rather than throwing when the record type is unreadable — the caller
 * then degrades to the on-device percentile fallback. RHR only feeds an integrity
 * flag, so it must never be able to take the whole read down, which is exactly
 * what a missing READ_RESTING_HEART_RATE permission did on the S26 Ultra on
 * 2026-09-07.
 */
export async function readRhrRecords(
  readRecords: ReadRecordsFn,
  days: number,
  tzOffsetMin: number,
  nowMs: number = Date.now(),
): Promise<RhrNight[]> {
  try {
    const startMs = nowMs - days * 24 * 60 * 60_000;
    const result = await readRecords('RestingHeartRate', {
      timeRangeFilter: {
        operator: 'between',
        startTime: toIso(startMs),
        endTime: toIso(nowMs),
      },
    });

    // One value per night: Health Connect may hold several, so keep the last.
    const byNight = new Map<string, number>();
    for (const record of result.records as HcRestingHeartRateRecord[]) {
      if (mapRecordingMethod(record.metadata?.recordingMethod) === 'MANUAL') continue;
      byNight.set(localDateKey(Date.parse(record.time), tzOffsetMin), record.beatsPerMinute);
    }

    return [...byNight.entries()]
      .map(([nightDate, restingBpm]) => ({ nightDate, restingBpm }))
      .sort((a, b) => (a.nightDate < b.nightDate ? -1 : 1));
  } catch {
    return [];
  }
}
