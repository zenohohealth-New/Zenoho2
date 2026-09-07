/**
 * The single source of truth for which Android permissions this app requires.
 *
 * Three permission bugs in two tasks all had the same shape: the code needed a
 * permission that never reached the manifest, and nothing checked the gap.
 *   - `READ_RESTING_HEART_RATE` — requested as a Health Connect record type in
 *     code, absent from app.json. Cost two device runs (R-001 §9).
 *   - `POST_NOTIFICATIONS` — the package was installed and used, but the
 *     permission was never added to expo.android.permissions. Would have failed
 *     silently on Android 13+ (R-002 §5). Measured mechanism: app.json's
 *     `android.permissions` is what reaches the manifest; the expo-notifications
 *     config plugin does NOT contribute this permission.
 *
 * So: declare the mapping here, derive the requirement from it, and let
 * tests/manifest-permissions.test.ts fail when app.json or the generated manifest
 * disagrees. Adding a record type to the bridge without adding it here is itself
 * caught, because the test cross-checks the bridge's own permission list.
 */

/** Health Connect record type → the Android permission that allows reading it. */
export const HEALTH_RECORD_PERMISSIONS: Readonly<Record<string, string>> = {
  SleepSession: 'android.permission.health.READ_SLEEP',
  HeartRate: 'android.permission.health.READ_HEART_RATE',
  RestingHeartRate: 'android.permission.health.READ_RESTING_HEART_RATE',
  BackgroundAccessPermission: 'android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND',
  ReadHealthDataHistory: 'android.permission.health.READ_HEALTH_DATA_HISTORY',
};

/** Permissions required by a module the app imports, rather than by a record type. */
export const MODULE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  'expo-notifications': ['android.permission.POST_NOTIFICATIONS'],
};

/**
 * Every Android permission this app must declare.
 *
 * Keep this list exhaustive for permissions Zenoho asks for itself. It is
 * deliberately NOT the whole manifest: Expo's dev client contributes others
 * (INTERNET, storage, overlay) that are not ours to declare and not ours to gate.
 */
export const REQUIRED_ANDROID_PERMISSIONS: readonly string[] = [
  ...Object.values(HEALTH_RECORD_PERMISSIONS),
  ...Object.values(MODULE_PERMISSIONS).flat(),
];

/**
 * Permissions that must NEVER appear. D-010 and the T-001 constraint: Zenoho
 * reads health data and never writes it, so any write permission in the manifest
 * is a defect regardless of how it got there.
 */
export const FORBIDDEN_ANDROID_PERMISSION_PATTERNS: readonly RegExp[] = [
  /^android\.permission\.health\.WRITE_/,
];
