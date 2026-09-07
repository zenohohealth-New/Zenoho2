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
  options: {
    timeRangeFilter: { operator: 'between'; startTime: string; endTime: string };
    pageSize?: number;
    pageToken?: string;
  },
) => Promise<{ records: unknown[]; pageToken?: string }>;

/**
 * Health Connect caps a single read at 1000 records and returns them in
 * ascending time order, so an unpaginated read of a 36-hour window returns the
 * OLDEST 1000 samples — which on a device with continuous heart rate is the day
 * before the night in question. That is what produced a 0% wear ratio against
 * 1000 samples on the S26 Ultra on 2026-09-07.
 */
export const HC_PAGE_SIZE = 1000;

/** Guards against an unbounded loop if a provider ever returns a stable token. */
export const HC_MAX_PAGES = 50;

/** Read every page for a record type, not just the first. */
async function readAllPages(
  readRecords: ReadRecordsFn,
  recordType: string,
  timeRangeFilter: { operator: 'between'; startTime: string; endTime: string },
): Promise<unknown[]> {
  const all: unknown[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < HC_MAX_PAGES; page += 1) {
    const result = await readRecords(recordType, {
      timeRangeFilter,
      pageSize: HC_PAGE_SIZE,
      pageToken,
    });
    all.push(...result.records);
    if (!result.pageToken || result.records.length === 0) return all;
    pageToken = result.pageToken;
  }
  return all;
}

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
    const sleepRecords = await readAllPages(readRecords, 'SleepSession', timeRangeFilter);
    sessions = (sleepRecords as HcSleepRecord[]).map((r) => ({
      // dataOrigin is the D-009 L1 evidence; keep it verbatim, never normalise.
      sourceId: r.metadata?.dataOrigin ?? '',
      startMs: Date.parse(r.startTime),
      endMs: Date.parse(r.endTime),
      recordingMethod: mapRecordingMethod(r.metadata?.recordingMethod),
    }));
  } catch (e) {
    readErrors.push({ kind: 'sleep', message: describe(e) });
  }

  // Scope the heart-rate read to the sessions we actually found. Wear presence
  // only ever looks inside a sleep session, so reading the whole 36-hour window
  // buys nothing and costs the page cap above. Falls back to the full window when
  // there are no sessions, so eligibility still has heart rate to look at.
  const hrRange =
    sessions.length > 0
      ? {
          operator: 'between' as const,
          startTime: toIso(Math.min(...sessions.map((x) => x.startMs))),
          endTime: toIso(Math.max(...sessions.map((x) => x.endMs))),
        }
      : timeRangeFilter;

  const hr: HrSample[] = [];
  try {
    const heartRecords = await readAllPages(readRecords, 'HeartRate', hrRange);
    for (const record of heartRecords as HcHeartRateRecord[]) {
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
    const records = await readAllPages(readRecords, 'RestingHeartRate', {
      operator: 'between',
      startTime: toIso(startMs),
      endTime: toIso(nowMs),
    });

    // One value per night: Health Connect may hold several, so keep the last.
    const byNight = new Map<string, number>();
    for (const record of records as HcRestingHeartRateRecord[]) {
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
