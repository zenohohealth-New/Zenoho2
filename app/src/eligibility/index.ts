/**
 * Source eligibility (D-042, D-009 L1, D-019).
 *
 * **Health Connect is the gate.** Zenoho keeps no allowlist and no blocklist. If
 * a companion app writes a sleep session, the session counts, whatever the brand
 * on the strap. `sourceId` is recorded verbatim and never judged.
 *
 * D-042 replaced D-003's brand lists because they were wrong in both directions.
 * They excluded users whose device would have worked, on desk research that went
 * stale the moment a firmware update shipped; and every id in them was a guessed
 * package string, so a *correct* brand with a mistyped id fell through to the
 * same place an unknown one did. The lists cost real users and bought nothing
 * the data itself does not say better.
 *
 * What survives, because neither rule is about brands:
 *
 *  - **D-009 L1** — a manually entered session is never eligible. Someone typing
 *    "asleep at 23:00" is not evidence, whichever app they typed it into.
 *  - **The phone exclusion** — sleep a phone inferred by itself is still
 *    ineligible (D-003's substantive rule, which D-042 does not lift). This is
 *    now enforced by requiring heart rate across the session from a source that
 *    is itself eligible, rather than by naming apps. See `hasOwnSourceHr`.
 *
 * The phone exclusion is deliberately a property of the data, not a claim about
 * identity, and that is the stronger test: a phone has no sensor that can
 * measure heart rate through a night, so "HR is present across this session"
 * cannot be satisfied by a phone inferring sleep from screen-off time. Naming
 * Samsung Health would have been worse as well as more brittle — the same
 * package writes watch-derived sleep when a watch is paired, and phone-derived
 * sleep when one is not, so the package name cannot tell the two apart even in
 * principle. R-005 records what it would take to do this from Health Connect's
 * own device metadata, and why that is not yet possible.
 */
import type { HrSample, RecordingMethod, SleepSession } from '../derive/types';

export type Platform = 'android' | 'ios';

/** Two outcomes now. There is no third "unknown brand" state, because there are no brands. */
export type SourceClass = 'ELIGIBLE' | 'INELIGIBLE';

export interface SourceVerdict {
  readonly sourceClass: SourceClass;
  readonly reason: 'WEARABLE_SOURCE' | 'MANUAL_ENTRY';
}

const ELIGIBLE: SourceVerdict = { sourceClass: 'ELIGIBLE', reason: 'WEARABLE_SOURCE' };
const MANUAL: SourceVerdict = { sourceClass: 'INELIGIBLE', reason: 'MANUAL_ENTRY' };

/**
 * Classify one source. The only thing that can disqualify it is being typed in
 * by hand (D-009 L1).
 *
 * `platform` is retained in the signature although both platforms now behave
 * identically: HealthKit and Health Connect may yet diverge on what they report,
 * and threading it through costs nothing while removing it from every call site
 * costs a diff that would have to be undone.
 */
export function classifySource(
  _sourceId: string,
  recordingMethod: RecordingMethod,
  _platform: Platform,
): SourceVerdict {
  return recordingMethod === 'MANUAL' ? MANUAL : ELIGIBLE;
}

export type EligibilityOutcome = 'ELIGIBLE' | 'NO_WEARABLE_SOURCE';

export interface EligibilityResult {
  readonly outcome: EligibilityOutcome;
  /** Source ids that qualified, for the debug screen. Never uploaded (D-010). */
  readonly qualifyingSources: readonly string[];
}

export const ELIGIBILITY_LOOKBACK_DAYS = 7;

/**
 * True when this session carries heart rate from a source that is itself
 * eligible (D-019: a manually entered HR must not be able to vouch for a night).
 *
 * This is the phone exclusion. It is a weaker claim than "this came from a
 * watch" and an honest one: it says the session is accompanied by a signal a
 * phone cannot produce on its own.
 */
function hasOwnSourceHr(
  session: SleepSession,
  hr: readonly HrSample[],
  platform: Platform,
): boolean {
  return hr.some(
    (h) =>
      h.atMs >= session.startMs &&
      h.atMs < session.endMs &&
      classifySource(h.sourceId, h.recordingMethod, platform).sourceClass === 'ELIGIBLE',
  );
}

/**
 * AC-1: a fresh install is eligible when some wearable wrote a sleep session
 * with heart rate in the last 7 days.
 *
 * The HR requirement now applies to every source rather than only to
 * unrecognised ones. Under the old rule a listed brand was trusted without it,
 * which meant the check was lenient exactly where a brand list was most likely
 * to be wrong. One rule for everyone is both simpler and stricter.
 */
export function checkEligibility(
  sessions: readonly SleepSession[],
  hr: readonly HrSample[],
  platform: Platform,
  nowMs: number,
  lookbackDays: number = ELIGIBILITY_LOOKBACK_DAYS,
): EligibilityResult {
  const since = nowMs - lookbackDays * 24 * 60 * 60_000;
  const qualifying: string[] = [];

  for (const s of sessions) {
    if (s.endMs < since) continue;
    if (classifySource(s.sourceId, s.recordingMethod, platform).sourceClass !== 'ELIGIBLE') {
      continue;
    }
    if (!hasOwnSourceHr(s, hr, platform)) continue;
    if (!qualifying.includes(s.sourceId)) qualifying.push(s.sourceId);
  }

  return {
    outcome: qualifying.length > 0 ? 'ELIGIBLE' : 'NO_WEARABLE_SOURCE',
    qualifyingSources: qualifying,
  };
}

/**
 * Copy for the rejection path (spec §11).
 *
 * No brand names: the previous version recommended Mi Band and Amazfit, which
 * D-042 makes both wrong and unnecessary — the app cannot know which devices
 * work, only whether this one is sending data. No health claim either.
 */
export const NO_WEARABLE_COPY = {
  title: "We can't see a wearable yet",
  body:
    'Zenoho reads sleep and heart rate from Health Connect. Any watch or ring whose app ' +
    'sends both will work. Sleep recorded by a phone on its own has no heart rate to check ' +
    'it against, so it counts as no data.',
} as const;

/**
 * Shown on a night that came back empty. The founder lost a night to a watch in
 * battery-saver mode on 2026-09-09, which silently stops heart-rate logging: the
 * sleep session still arrives, the HR does not, and the night reads NO_DATA with
 * nothing on screen suggesting where to look.
 */
export const NO_DATA_HINT =
  'No sleep data from your watch. Check it was worn and not in battery-saver mode.';
