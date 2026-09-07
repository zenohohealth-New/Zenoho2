/**
 * Source eligibility (spec §4 "Eligible source", §9 allow-list, D-003, D-009 L1).
 *
 * Three outcomes, because §9 deliberately does not fail closed on unknown brands:
 *   ALLOWED  - listed wearable companion app
 *   UNKNOWN  - unrecognised origin; eligible only if HR is present, and always
 *              carries integrity=UNVERIFIED so a new brand is not silently excluded
 *   BLOCKED  - phone OS writer, or a manually entered session
 */
import allowlist from './source-allowlist.v1.json';
import type { RecordingMethod, SleepSession } from '../derive/types';

export type Platform = 'android' | 'ios';

export type SourceClass = 'ALLOWED' | 'UNKNOWN' | 'BLOCKED';

export interface SourceVerdict {
  readonly sourceClass: SourceClass;
  /** True when §9 marks the brand itself UNVERIFIED (e.g. Ultrahuman on Android). */
  readonly brandUnverified: boolean;
  readonly reason: 'ALLOWLISTED' | 'UNKNOWN_ORIGIN' | 'PHONE_OS' | 'MANUAL_ENTRY';
}

export const ALLOWLIST_VERSION: number = allowlist.version;

function androidIds() {
  return {
    allow: allowlist.android.allow.map((e) => e.package),
    unverified: allowlist.android.unverifiedBrand.map((e) => e.package),
    block: allowlist.android.block.map((e) => e.package),
  };
}

function iosIds() {
  return {
    allow: allowlist.ios.allow.map((e) => e.bundlePrefix),
    unverified: allowlist.ios.unverifiedBrand.map((e) => e.bundlePrefix),
    block: allowlist.ios.block.map((e) => (e as { bundlePrefix: string }).bundlePrefix),
  };
}

/**
 * Classify one source id. On iOS the allow-list holds bundle *prefixes*, so a
 * prefix match is used; on Android dataOrigin is an exact package name.
 */
export function classifySource(
  sourceId: string,
  recordingMethod: RecordingMethod,
  platform: Platform,
): SourceVerdict {
  // D-009 L1: a manual entry is never eligible, whatever app wrote it.
  if (recordingMethod === 'MANUAL') {
    return { sourceClass: 'BLOCKED', brandUnverified: false, reason: 'MANUAL_ENTRY' };
  }

  const id = sourceId.trim();
  const ids = platform === 'android' ? androidIds() : iosIds();
  const matches = (candidate: string) =>
    platform === 'android' ? id === candidate : id === candidate || id.startsWith(`${candidate}.`);

  if (ids.block.some(matches)) {
    return { sourceClass: 'BLOCKED', brandUnverified: false, reason: 'PHONE_OS' };
  }
  if (ids.allow.some(matches)) {
    return { sourceClass: 'ALLOWED', brandUnverified: false, reason: 'ALLOWLISTED' };
  }
  if (ids.unverified.some(matches)) {
    return { sourceClass: 'ALLOWED', brandUnverified: true, reason: 'ALLOWLISTED' };
  }
  return { sourceClass: 'UNKNOWN', brandUnverified: true, reason: 'UNKNOWN_ORIGIN' };
}

export type EligibilityOutcome = 'ELIGIBLE' | 'NO_WEARABLE_SOURCE';

export interface EligibilityResult {
  readonly outcome: EligibilityOutcome;
  /** Source ids that qualified, for the report/debug screen. Never uploaded. */
  readonly qualifyingSources: readonly string[];
  readonly brandUnverified: boolean;
}

export const ELIGIBILITY_LOOKBACK_DAYS = 7;

/**
 * AC-1: a fresh install is eligible when a Tier-1 source wrote a sleep session
 * in the last 7 days. UNKNOWN origins count only if the night also carried HR,
 * matching §9's "unknown origin with no HR -> NO_DATA".
 */
export function checkEligibility(
  sessions: readonly SleepSession[],
  hr: readonly { atMs: number }[],
  platform: Platform,
  nowMs: number,
  lookbackDays: number = ELIGIBILITY_LOOKBACK_DAYS,
): EligibilityResult {
  const since = nowMs - lookbackDays * 24 * 60 * 60_000;
  const qualifying: string[] = [];
  let brandUnverified = false;

  for (const s of sessions) {
    if (s.endMs < since) continue;
    const verdict = classifySource(s.sourceId, s.recordingMethod, platform);
    if (verdict.sourceClass === 'BLOCKED') continue;
    if (verdict.sourceClass === 'UNKNOWN') {
      const hasHr = hr.some((h) => h.atMs >= s.startMs && h.atMs < s.endMs);
      if (!hasHr) continue;
    }
    if (!qualifying.includes(s.sourceId)) qualifying.push(s.sourceId);
    if (verdict.brandUnverified) brandUnverified = true;
  }

  return {
    outcome: qualifying.length > 0 ? 'ELIGIBLE' : 'NO_WEARABLE_SOURCE',
    qualifyingSources: qualifying,
    brandUnverified,
  };
}

/**
 * Copy for the rejection path (spec §11). Wording follows the copy rule: no
 * health claim, no promise — it only describes what the app can and cannot read.
 */
export const NO_WEARABLE_COPY = {
  title: "We can't see a wearable yet",
  body:
    'Zenoho needs a watch or ring that sends both sleep and heart rate to Health Connect. ' +
    'Sleep recorded by a phone alone cannot be checked, so it counts as no data. ' +
    'Budget bands that work include Mi Band and Amazfit.',
} as const;
