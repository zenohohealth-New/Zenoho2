/**
 * Source eligibility under D-042: Health Connect is the gate.
 *
 * The previous version of this file had 13 green tests asserting a policy that
 * has been retired — that Garmin is allowed, that Ultrahuman is "unverified",
 * that an unrecognised package is second-class. Those tests are deleted rather
 * than adapted. A test that passes for a rule nobody follows any more is worse
 * than no test: it reads as coverage.
 *
 * What is asserted now:
 *   1. No brand is privileged, and no brand is refused.
 *   2. A hand-typed session is still never eligible (D-009 L1).
 *   3. Sleep a phone inferred by itself is still ineligible — enforced by
 *      requiring heart rate the phone cannot have produced, not by naming apps.
 *   4. The brand lists are gone from the codebase entirely (AC-5.2).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  checkEligibility,
  classifySource,
  ELIGIBILITY_LOOKBACK_DAYS,
  NO_DATA_HINT,
  NO_WEARABLE_COPY,
} from '../app/src/eligibility';
import type { HrSample, RecordingMethod, SleepSession } from '../app/src/derive/types';

const NOW = Date.parse('2026-09-10T08:00:00Z');
const NIGHT_START = Date.parse('2026-09-09T22:30:00Z');
const NIGHT_END = Date.parse('2026-09-10T06:30:00Z');

function session(sourceId: string, recordingMethod: RecordingMethod = 'AUTOMATIC'): SleepSession {
  return { sourceId, startMs: NIGHT_START, endMs: NIGHT_END, recordingMethod };
}

/** HR spread through the session, from the same app that wrote the sleep. */
function hrFrom(sourceId: string, recordingMethod: RecordingMethod = 'AUTOMATIC'): HrSample[] {
  const out: HrSample[] = [];
  for (let t = NIGHT_START; t < NIGHT_END; t += 5 * 60_000) {
    out.push({ sourceId, atMs: t, bpm: 56, recordingMethod });
  }
  return out;
}

// Deliberately a mix of brands that used to be allowed, used to be blocked, and
// were never listed at all. Under D-042 they must be indistinguishable.
const GARMIN = 'com.garmin.android.apps.connectmobile';
const NOISE = 'com.noisefit';
const BOAT = 'com.boat.crest';
const FIREBOLTT = 'com.fireboltt.darwin';
const ULTRAHUMAN = 'com.ultrahuman.app';
const NEVER_SEEN = 'com.some.watch.nobody.has.heard.of';

describe('no brand is privileged or refused (D-042)', () => {
  for (const pkg of [GARMIN, NOISE, BOAT, FIREBOLTT, ULTRAHUMAN, NEVER_SEEN]) {
    it(`accepts ${pkg}`, () => {
      const r = checkEligibility([session(pkg)], hrFrom(pkg), 'android', NOW);
      expect(r.outcome).toBe('ELIGIBLE');
      expect(r.qualifyingSources).toEqual([pkg]);
    });
  }

  it('records source_id verbatim, without normalising or judging it', () => {
    const odd = 'com.Example.Watch_2024';
    const r = checkEligibility([session(odd)], hrFrom(odd), 'android', NOW);
    expect(r.qualifyingSources).toEqual([odd]);
  });

  it('treats a formerly blocked brand exactly like a formerly allowed one', () => {
    const allowed = checkEligibility([session(GARMIN)], hrFrom(GARMIN), 'android', NOW);
    const blocked = checkEligibility([session(NOISE)], hrFrom(NOISE), 'android', NOW);
    expect(blocked.outcome).toBe(allowed.outcome);
  });

  it('applies the same rule on iOS', () => {
    const r = checkEligibility([session(NEVER_SEEN)], hrFrom(NEVER_SEEN), 'ios', NOW);
    expect(r.outcome).toBe('ELIGIBLE');
  });
});

describe('manual entry is never eligible (D-009 L1)', () => {
  it('rejects a hand-typed session from an otherwise fine app', () => {
    const r = checkEligibility([session(GARMIN, 'MANUAL')], hrFrom(GARMIN), 'android', NOW);
    expect(r.outcome).toBe('NO_WEARABLE_SOURCE');
  });

  it('classifySource reports why', () => {
    expect(classifySource(GARMIN, 'MANUAL', 'android')).toEqual({
      sourceClass: 'INELIGIBLE',
      reason: 'MANUAL_ENTRY',
    });
  });

  it('hand-typed heart rate cannot vouch for a session (D-019)', () => {
    // The sleep session is automatic and fine; the only HR covering it was typed
    // in. That must not be enough, or the phone exclusion is trivially defeated.
    const r = checkEligibility([session(NEVER_SEEN)], hrFrom(NEVER_SEEN, 'MANUAL'), 'android', NOW);
    expect(r.outcome).toBe('NO_WEARABLE_SOURCE');
  });
});

describe('phone-inferred sleep stays ineligible (AC-5.1b)', () => {
  const PHONE_APP = 'com.sec.android.app.shealth';

  it('rejects a phone-only health app with no heart rate', () => {
    // Samsung Health with no watch paired: it writes a sleep session inferred
    // from phone signals, and no HR, because a phone has no sensor for it.
    const r = checkEligibility([session(PHONE_APP)], [], 'android', NOW);
    expect(r.outcome).toBe('NO_WEARABLE_SOURCE');
  });

  it('accepts the SAME app once a watch is paired and heart rate arrives', () => {
    // The discriminator is the data, not the package. This is the case a brand
    // blocklist got wrong: blocking Samsung Health would refuse a Galaxy Watch.
    const r = checkEligibility([session(PHONE_APP)], hrFrom(PHONE_APP), 'android', NOW);
    expect(r.outcome).toBe('ELIGIBLE');
  });

  it('rejects heart rate that falls outside the session window', () => {
    const outside = hrFrom(GARMIN).map((h) => ({ ...h, atMs: h.atMs - 24 * 60 * 60_000 }));
    const r = checkEligibility([session(GARMIN)], outside, 'android', NOW);
    expect(r.outcome).toBe('NO_WEARABLE_SOURCE');
  });
});

describe('the lookback window', () => {
  it('ignores a session older than the lookback', () => {
    const old = ELIGIBILITY_LOOKBACK_DAYS + 1;
    const s: SleepSession = {
      sourceId: GARMIN,
      startMs: NOW - old * 24 * 60 * 60_000,
      endMs: NOW - old * 24 * 60 * 60_000 + 8 * 60 * 60_000,
      recordingMethod: 'AUTOMATIC',
    };
    const hr: HrSample[] = [
      { sourceId: GARMIN, atMs: s.startMs + 60_000, bpm: 55, recordingMethod: 'AUTOMATIC' },
    ];
    expect(checkEligibility([s], hr, 'android', NOW).outcome).toBe('NO_WEARABLE_SOURCE');
  });

  it('no sessions at all is not eligible', () => {
    expect(checkEligibility([], [], 'android', NOW).outcome).toBe('NO_WEARABLE_SOURCE');
  });
});

describe('the brand lists are gone (AC-5.2)', () => {
  const APP_SRC = new URL('../app/src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

  function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, acc);
      else acc.push(full);
    }
    return acc;
  }

  it('the allow-list file does not exist', () => {
    expect(existsSync(join(APP_SRC, 'eligibility', 'source-allowlist.v2.json'))).toBe(false);
    expect(existsSync(join(APP_SRC, 'eligibility', 'source-allowlist.v1.json'))).toBe(false);
  });

  it('no source file mentions the file name or the three list keys', () => {
    const offenders: string[] = [];
    for (const f of walk(APP_SRC)) {
      const src = readFileSync(f, 'utf8');
      for (const needle of ['source-allowlist', 'unverifiedBrand', 'ALLOWLIST_VERSION']) {
        if (src.includes(needle)) offenders.push(`${f}: ${needle}`);
      }
      // The list keys as *code*, not the English words in a comment explaining
      // why they are gone.
      if (/allowlist\.(android|ios)\.(allow|block|unverifiedBrand)/.test(src)) {
        offenders.push(`${f}: allowlist lookup`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no brand name appears in user-facing copy', () => {
    const copy = `${NO_WEARABLE_COPY.title} ${NO_WEARABLE_COPY.body} ${NO_DATA_HINT}`.toLowerCase();
    for (const brand of ['garmin', 'fitbit', 'samsung', 'oura', 'whoop', 'noise', 'boat',
                         'fire-boltt', 'mi band', 'amazfit', 'xiaomi', 'apple', 'polar',
                         'withings', 'ultrahuman']) {
      expect(copy, `copy names ${brand}`).not.toContain(brand);
    }
  });

  it('no health claim in the copy, and it still says what the app reads', () => {
    const copy = `${NO_WEARABLE_COPY.title} ${NO_WEARABLE_COPY.body}`.toLowerCase();
    for (const claim of ['improve', 'better sleep', 'health benefit', 'cure', 'treat']) {
      expect(copy).not.toContain(claim);
    }
    expect(copy).toContain('health connect');
  });

  it('the No-data hint says what to check, without naming a device', () => {
    expect(NO_DATA_HINT).toContain('battery-saver');
    expect(NO_DATA_HINT.toLowerCase()).not.toContain('garmin');
  });
});
