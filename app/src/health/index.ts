/**
 * Platform dispatch for the health bridge (T-001 deliverable 2).
 *
 * The platform modules are required lazily so that importing this file from a
 * pure Node test does not pull native modules into the process.
 */
import { Platform } from 'react-native';
import type { HealthStore } from './types';

export * from './types';
export { nightReadWindow } from './window';

let cached: HealthStore | null = null;

export function getHealthStore(): HealthStore {
  if (cached) return cached;
  if (Platform.OS === 'android') {
    // Lazy require, not a static import: a static import would pull the native
    // module into pure Node test runs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { HealthConnectStore } = require('./healthConnect.android');
    cached = new HealthConnectStore();
  } else if (Platform.OS === 'ios') {
    // Lazy require, as above.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { HealthKitStore } = require('./healthKit.ios');
    cached = new HealthKitStore();
  } else {
    throw new Error(`Zenoho requires iOS or Android; got ${Platform.OS}`);
  }
  return cached as HealthStore;
}

/** Test seam: lets a fake store stand in without touching native modules. */
export function __setHealthStoreForTests(store: HealthStore | null): void {
  cached = store;
}
