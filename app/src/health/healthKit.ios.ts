/**
 * iOS bridge — HealthKit (D-011, spec §12).
 *
 * STATUS: compiles, NEVER RUN ON A DEVICE (D-013 — Windows dev machine, no iPhone,
 * no Mac, no Apple Developer account). Treat every behaviour here as unverified
 * until an EAS build reaches TestFlight on real hardware.
 *
 * Read-only: no save or delete HealthKit API is imported.
 */
import {
  enableBackgroundDelivery,
  getRequestStatusForAuthorization,
  isHealthDataAvailable,
  queryCategorySamples,
  queryQuantitySamples,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';
import type { HrSample, RecordingMethod, SleepSession } from '../derive/types';
import type { HealthStore, NightReadResult, PermissionOutcome } from './types';
import { nightReadWindow } from './window';

const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis' as const;
const HEART_RATE = 'HKQuantityTypeIdentifierHeartRate' as const;

/**
 * HKCategoryValueSleepAnalysis values that mean "asleep". `inBed` (0) is excluded:
 * time in bed is not sleep, and treating it as sleep would inflate the window.
 */
const ASLEEP_VALUES = new Set([1, 3, 4, 5]); // asleepUnspecified, core, deep, REM

function recordingMethodFrom(metadata: Record<string, unknown> | undefined): RecordingMethod {
  if (metadata && metadata.HKWasUserEntered === true) return 'MANUAL';
  return 'AUTOMATIC';
}

export class HealthKitStore implements HealthStore {
  readonly platform = 'ios' as const;

  async isAvailable(): Promise<boolean> {
    return isHealthDataAvailable();
  }

  async requestReadPermissions(): Promise<PermissionOutcome> {
    if (!isHealthDataAvailable()) return 'UNAVAILABLE';
    // `toShare` is deliberately empty: Zenoho never writes to HealthKit.
    const ok = await requestAuthorization({ toRead: [SLEEP, HEART_RATE], toShare: [] } as never);
    if (!ok) return 'DENIED';
    // Spec §12: background delivery for sleepAnalysis + heartRate.
    await enableBackgroundDelivery(SLEEP, 'hourly' as never);
    await enableBackgroundDelivery(HEART_RATE, 'hourly' as never);
    return 'GRANTED';
  }

  async hasBackgroundAccess(): Promise<boolean> {
    // HealthKit exposes no direct read-back of background-delivery state; the
    // authorization request status is the closest signal available.
    const status = await getRequestStatusForAuthorization({
      toRead: [SLEEP, HEART_RATE],
      toShare: [],
    } as never);
    return status !== undefined;
  }

  async readNight(nightDate: string, tzOffsetMin: number): Promise<NightReadResult> {
    const { startMs, endMs } = nightReadWindow(nightDate, tzOffsetMin);
    const filter = { date: { startDate: new Date(startMs), endDate: new Date(endMs) } };

    const categorySamples = await queryCategorySamples(SLEEP, { filter, limit: -1 });
    const sessions: SleepSession[] = categorySamples
      .filter((s) => ASLEEP_VALUES.has(s.value as unknown as number))
      .map((s) => ({
        // D-009 L1 evidence: the writing app's bundle id, kept verbatim.
        sourceId: s.sourceRevision.source.bundleIdentifier,
        startMs: s.startDate.getTime(),
        endMs: s.endDate.getTime(),
        recordingMethod: recordingMethodFrom(s.metadata as Record<string, unknown>),
      }));

    const hrSamples = await queryQuantitySamples(HEART_RATE, {
      filter,
      limit: -1,
      unit: 'count/min' as never,
    });
    const hr: HrSample[] = hrSamples.map((s) => ({
      sourceId: s.sourceRevision.source.bundleIdentifier,
      atMs: s.startDate.getTime(),
      bpm: s.quantity,
    }));

    return { sessions, hr };
  }
}
