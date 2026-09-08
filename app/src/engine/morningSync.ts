/**
 * The morning sync trigger (spec §10, first row).
 *
 * A *local* notification scheduled for wake_target + 60 min. Local, not push:
 * there is no server in T-002 and no network at all, and a local notification
 * needs neither. Opening it foregrounds the app, which runs the derivation —
 * the design D-011 settled on for Android, where background reads are not
 * guaranteed.
 *
 * Spec §10 caps pushes at 2/day/user. This schedules exactly one.
 *
 * PLATFORM BEHAVIOUR, measured 2026-09-08 on an S26 Ultra (Android 16, battery
 * setting "Optimised"): the trigger fired at 08:05 for an 08:00 schedule. Samsung
 * batches inexact alarms, and a 0–15 minute delay is expected, not a defect.
 * Exact alarms are deliberately NOT used: they need an extra permission, invite a
 * per-OEM fight, and buy nothing here — the derivation runs whenever the app is
 * foregrounded, so a late or missing notification costs convenience, not
 * correctness.
 */
import * as Notifications from 'expo-notifications';
import {
  KEY_MORNING_LAST_FIRED,
  KEY_MORNING_LAST_SCHEDULED,
  KEY_MORNING_NEXT_AT,
  kvGetNumber,
  kvSetNumber,
} from '../storage/kv';
import {
  judgeMorningSync,
  morningSyncMinute,
  nextDailyOccurrenceMs,
  type MorningSyncVerdict,
} from './morningSyncTime';

export { MORNING_SYNC_OFFSET_MIN, morningSyncMinute } from './morningSyncTime';

export const MORNING_SYNC_ID = 'zenoho.morning-sync';

/** Copy rule (spec §11): states no health benefit, makes no claim. */
export const MORNING_SYNC_COPY = {
  title: 'Last night is ready',
  body: 'Open Zenoho to work out last night from your watch.',
} as const;

export type SchedulePermission = 'GRANTED' | 'DENIED';

export async function requestNotificationPermission(): Promise<SchedulePermission> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return 'GRANTED';
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted ? 'GRANTED' : 'DENIED';
}

/**
 * Schedule (or reschedule) the daily morning trigger, and record when it is next
 * expected so a silent morning can later be told apart from an unscheduled one.
 *
 * Safe to call on every app open, and it is: a schedule can be lost to a
 * force-stop or a cleared app, and nothing else would ever put it back.
 */
export async function scheduleMorningSync(
  wakeTargetMin: number,
  nowMs: number = Date.now(),
  tzOffsetMin: number = -new Date().getTimezoneOffset(),
): Promise<number> {
  await cancelMorningSync();

  const minute = morningSyncMinute(wakeTargetMin);
  await Notifications.scheduleNotificationAsync({
    identifier: MORNING_SYNC_ID,
    content: { title: MORNING_SYNC_COPY.title, body: MORNING_SYNC_COPY.body },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: Math.floor(minute / 60),
      minute: minute % 60,
    },
  });

  const nextAt = nextDailyOccurrenceMs(minute, nowMs, tzOffsetMin);
  await kvSetNumber(KEY_MORNING_NEXT_AT, nextAt);
  await kvSetNumber(KEY_MORNING_LAST_SCHEDULED, nowMs);
  return nextAt;
}

export async function cancelMorningSync(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(MORNING_SYNC_ID);
  } catch {
    // Nothing scheduled yet; cancelling an absent id is not an error worth raising.
  }
}

/** Called from the notification listeners so a real fire is recorded. */
export async function recordMorningSyncFired(nowMs: number = Date.now()): Promise<void> {
  await kvSetNumber(KEY_MORNING_LAST_FIRED, nowMs);
}

export interface MorningSyncStatus {
  /** How many triggers the OS says are armed. Should be exactly 1. */
  readonly scheduledCount: number;
  readonly nextAtMs: number | null;
  readonly lastFiredMs: number | null;
  readonly verdict: MorningSyncVerdict;
}

/**
 * What the diagnostics screen shows: next scheduled sync · last fired.
 *
 * Visible on any user's phone, which is the point — OEM battery handling varies
 * enough that "it works on mine" is not evidence about anyone else's.
 */
export async function morningSyncStatus(
  nowMs: number = Date.now(),
): Promise<MorningSyncStatus> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const scheduledCount = all.filter((n) => n.identifier === MORNING_SYNC_ID).length;
  const nextAtMs = await kvGetNumber(KEY_MORNING_NEXT_AT);
  const lastFiredMs = await kvGetNumber(KEY_MORNING_LAST_FIRED);

  return {
    scheduledCount,
    nextAtMs,
    lastFiredMs,
    verdict: judgeMorningSync(nextAtMs, lastFiredMs, nowMs),
  };
}

/** For the harness: what is actually scheduled, as the OS sees it. */
export async function scheduledMorningSyncCount(): Promise<number> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return all.filter((n) => n.identifier === MORNING_SYNC_ID).length;
}
