/**
 * Main sleep session selection (spec §4).
 *
 * "the longest sleep session with start between 18:00 local (day D) and 12:00
 * local (day D+1), from an eligible source" — and §4 also fixes that night D
 * belongs to the calendar day the user wakes, so for night N the window runs
 * 18:00 on N-1 to 12:00 on N.
 */
import { localMidnightMs, MIN_MS } from './time';
import type { SleepSession } from './types';
import { classifySource, type Platform, type SourceVerdict } from '../eligibility';

export interface MainSessionPick {
  readonly session: SleepSession;
  readonly verdict: SourceVerdict;
}

export interface SessionWindow {
  /** 18:00 local on the day before the night date. */
  readonly fromMs: number;
  /** 12:00 local on the night date. */
  readonly toMs: number;
}

/** The 18:00(N-1) .. 12:00(N) start window for night `nightDate`. */
export function sessionWindow(nightDate: string, tzOffsetMin: number): SessionWindow {
  const midnightOfNight = localMidnightMs(nightDate, tzOffsetMin);
  return {
    fromMs: midnightOfNight - 6 * 60 * MIN_MS, // 18:00 previous day
    toMs: midnightOfNight + 12 * 60 * MIN_MS, // 12:00 night date
  };
}

/**
 * Pick the longest eligible session whose *start* falls in the window.
 * Ineligible sources are filtered out before "longest" is applied, so a long
 * manual entry cannot shadow a real, shorter wearable session.
 */
export function selectMainSession(
  sessions: readonly SleepSession[],
  nightDate: string,
  tzOffsetMin: number,
  platform: Platform,
): MainSessionPick | null {
  const { fromMs, toMs } = sessionWindow(nightDate, tzOffsetMin);

  let best: MainSessionPick | null = null;
  let bestDuration = -1;

  for (const s of sessions) {
    if (s.startMs < fromMs || s.startMs >= toMs) continue;
    if (s.endMs <= s.startMs) continue;

    const verdict = classifySource(s.sourceId, s.recordingMethod, platform);
    if (verdict.sourceClass !== 'ELIGIBLE') continue;

    const duration = s.endMs - s.startMs;
    // Ties break towards the earlier start so the pick is deterministic.
    if (duration > bestDuration || (duration === bestDuration && best !== null && s.startMs < best.session.startMs)) {
      best = { session: s, verdict };
      bestDuration = duration;
    }
  }

  return best;
}
