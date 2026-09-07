/**
 * AC-1: a device with Tier-1 wearable data in the last 7 days passes; a phone
 * with none is rejected with a suggestion. Plus the §9 classification rules.
 */
import { describe, expect, it } from 'vitest';
import {
  ALLOWLIST_VERSION,
  checkEligibility,
  classifySource,
  NO_WEARABLE_COPY,
} from '../app/src/eligibility';
import type { SleepSession } from '../app/src/derive/types';

const NOW = Date.parse('2026-09-07T06:00:00Z');
const DAY = 24 * 60 * 60_000;
const GARMIN = 'com.garmin.android.apps.connectmobile';

function session(sourceId: string, daysAgo: number, method: 'AUTOMATIC' | 'MANUAL' = 'AUTOMATIC'): SleepSession {
  const endMs = NOW - daysAgo * DAY;
  return { sourceId, startMs: endMs - 7 * 60 * 60_000, endMs, recordingMethod: method };
}

const hrIn = (s: SleepSession) => [{ atMs: s.startMs + 60_000 }];

describe('AC-1 — eligibility', () => {
  it('passes with a Tier-1 wearable session inside the 7-day window', () => {
    const s = session(GARMIN, 1);
    const r = checkEligibility([s], hrIn(s), 'android', NOW);
    expect(r.outcome).toBe('ELIGIBLE');
    expect(r.qualifyingSources).toEqual([GARMIN]);
    expect(r.brandUnverified).toBe(false);
  });

  it('rejects a phone with no sessions at all', () => {
    const r = checkEligibility([], [], 'android', NOW);
    expect(r.outcome).toBe('NO_WEARABLE_SOURCE');
    expect(r.qualifyingSources).toEqual([]);
  });

  it('rejects when the only wearable session is older than 7 days', () => {
    const s = session(GARMIN, 9);
    expect(checkEligibility([s], hrIn(s), 'android', NOW).outcome).toBe('NO_WEARABLE_SOURCE');
  });

  it('rejects a manual entry however recent', () => {
    const s = session(GARMIN, 0, 'MANUAL');
    expect(checkEligibility([s], hrIn(s), 'android', NOW).outcome).toBe('NO_WEARABLE_SOURCE');
  });

  it('rejects sleep written by the Health Connect platform itself', () => {
    const s = session('com.google.android.apps.healthdata', 1);
    expect(checkEligibility([s], hrIn(s), 'android', NOW).outcome).toBe('NO_WEARABLE_SOURCE');
  });

  it('accepts an unknown brand that carries heart rate, flagged unverified', () => {
    const s = session('com.newbrand.watchapp', 1);
    const r = checkEligibility([s], hrIn(s), 'android', NOW);
    expect(r.outcome).toBe('ELIGIBLE');
    expect(r.brandUnverified).toBe(true);
  });

  it('rejects an unknown brand with no heart rate (§9)', () => {
    const s = session('com.newbrand.watchapp', 1);
    expect(checkEligibility([s], [], 'android', NOW).outcome).toBe('NO_WEARABLE_SOURCE');
  });

  it('the rejection copy suggests a device and makes no health claim', () => {
    const text = `${NO_WEARABLE_COPY.title} ${NO_WEARABLE_COPY.body}`.toLowerCase();
    expect(text).toContain('mi band');
    for (const banned of ['improve', 'reduce risk', 'healthy', 'healthier', 'better sleep']) {
      expect(text).not.toContain(banned);
    }
  });
});

describe('§9 — source classification', () => {
  it('exposes a version so the allow-list can be rolled forward by evidence', () => {
    expect(ALLOWLIST_VERSION).toBe(1);
  });

  it('classifies Android packages by exact match', () => {
    expect(classifySource(GARMIN, 'AUTOMATIC', 'android').sourceClass).toBe('ALLOWED');
    expect(classifySource('com.garmin.android', 'AUTOMATIC', 'android').sourceClass).toBe('UNKNOWN');
  });

  it('classifies iOS bundles by prefix', () => {
    expect(classifySource('com.ouraring.oura.watch', 'AUTOMATIC', 'ios').sourceClass).toBe('ALLOWED');
    expect(classifySource('com.ouraringXXX', 'AUTOMATIC', 'ios').sourceClass).toBe('UNKNOWN');
  });

  it('marks brands §9 itself calls unverified', () => {
    const v = classifySource('com.ultrahuman.app', 'AUTOMATIC', 'android');
    expect(v.sourceClass).toBe('ALLOWED');
    expect(v.brandUnverified).toBe(true);
  });

  it('a manual entry is blocked before the allow-list is consulted', () => {
    expect(classifySource(GARMIN, 'MANUAL', 'android').reason).toBe('MANUAL_ENTRY');
  });
});
