/**
 * Device clock skew, measured without sending a timestamp (D-034).
 *
 * The server sets `computed_at`. The client contributes only
 * `device_clock_offset_min` — whole minutes of device-minus-server time, from a
 * one-time probe. An integer count of minutes is not a timestamp: it says
 * nothing about when anything happened, only how wrong this phone's clock is.
 */
import { KEY_CLOCK_OFFSET_MIN, kvGetNumber, kvSetNumber } from '../storage/kv';

/** Pure: minutes of device-minus-server time, rounded to the nearest whole minute. */
export function clockOffsetMinutes(deviceMs: number, serverMs: number): number {
  return Math.round((deviceMs - serverMs) / 60_000);
}

/**
 * Half the round trip, used to place the server's instant at the midpoint of the
 * request. Without this a slow network reads as a skewed clock.
 */
export function serverInstantFromProbe(
  sentMs: number,
  receivedMs: number,
  serverMs: number,
): number {
  const halfRoundTrip = (receivedMs - sentMs) / 2;
  return serverMs + halfRoundTrip;
}

/** Beyond this, the phone's clock is wrong enough to be worth surfacing. */
export const CLOCK_SKEW_NOTABLE_MIN = 5;

export function isNotableSkew(offsetMin: number | null): boolean {
  return offsetMin !== null && Math.abs(offsetMin) >= CLOCK_SKEW_NOTABLE_MIN;
}

export type ServerNow = () => Promise<{ serverMs: number }>;

/**
 * Probe once and cache. "One-time" is deliberate: the offset is a property of the
 * phone, it drifts slowly, and re-probing on every sync would add a round trip
 * per night for a number that barely moves.
 *
 * Returns null when the probe fails — offline, signed out, or the function is not
 * deployed. A missing offset is recorded as null rather than as zero, because
 * "not measured" and "measured as no skew" are different facts.
 */
export async function getDeviceClockOffsetMin(
  serverNow: ServerNow,
  now: () => number = Date.now,
): Promise<number | null> {
  const cached = await kvGetNumber(KEY_CLOCK_OFFSET_MIN);
  if (cached !== null) return cached;

  try {
    const sentMs = now();
    const { serverMs } = await serverNow();
    const receivedMs = now();

    const offset = clockOffsetMinutes(
      receivedMs,
      serverInstantFromProbe(sentMs, receivedMs, serverMs),
    );
    await kvSetNumber(KEY_CLOCK_OFFSET_MIN, offset);
    return offset;
  } catch {
    return null;
  }
}
