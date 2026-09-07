/**
 * The morning sync trigger (spec §10, first row).
 *
 * A *local* notification scheduled for wake_target + 60 min. Local, not push:
 * there is no server in T-002 and no network at all, and a local notification
 * needs neither. Opening it foregrounds the app, which runs the derivation —
 * which is the design D-011 settled on for Android, where background reads are
 * not guaranteed.
 *
 * Spec §10 caps pushes at 2/day/user. This schedules exactly one.
 */
import * as Notifications from 'expo-notifications';

export const MORNING_SYNC_OFFSET_MIN = 60;
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

/** wake_target + 60 min, wrapped into the next day if it runs past midnight. */
export function morningSyncMinute(wakeTargetMin: number): number {
  return (wakeTargetMin + MORNING_SYNC_OFFSET_MIN) % 1440;
}

/**
 * Schedule (or reschedule) the daily morning trigger. Cancels the previous one
 * first, so changing the commitment cannot leave two notifications behind.
 */
export async function scheduleMorningSync(wakeTargetMin: number): Promise<void> {
  await cancelMorningSync();

  const minute = morningSyncMinute(wakeTargetMin);
  await Notifications.scheduleNotificationAsync({
    identifier: MORNING_SYNC_ID,
    content: {
      title: MORNING_SYNC_COPY.title,
      body: MORNING_SYNC_COPY.body,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: Math.floor(minute / 60),
      minute: minute % 60,
    },
  });
}

export async function cancelMorningSync(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(MORNING_SYNC_ID);
  } catch {
    // Nothing scheduled yet; cancelling an absent id is not an error worth raising.
  }
}

/** For the harness: what is actually scheduled, as the OS sees it. */
export async function scheduledMorningSyncCount(): Promise<number> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return all.filter((n) => n.identifier === MORNING_SYNC_ID).length;
}
