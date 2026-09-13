/**
 * The upload boundary (D-010, spec §7, D-034).
 *
 * `toServerRow` is the ONLY sanctioned way to turn a night into something that
 * may cross the network. It is a whitelist, not a redaction: it constructs a new
 * object from named fields, so a field added to `DerivedNight` later cannot leak
 * by accident.
 *
 * Note what is absent and stays absent: `computed_at`. The server sets it
 * (D-034), because a client-sent timestamp would have cost the guard's absolute
 * no-timestamps invariant. `device_clock_offset_min` carries the skew instead,
 * as whole minutes.
 */
import type { DerivedNight } from '../derive/types';

/** Exactly the columns spec §7 permits the server to hold, minus server-set ones. */
export interface ServerDailyStateRow {
  readonly commitment_id: number;
  readonly night_date: string;
  readonly state: string;
  readonly integrity: string;
  readonly source_id: string | null;
  readonly wear_presence: boolean;
  readonly deviation_min: number | null;
  readonly frozen: boolean;
  readonly device_clock_offset_min: number | null;
}

export function toServerRow(
  night: DerivedNight,
  commitmentId: number,
  deviceClockOffsetMin: number | null,
): ServerDailyStateRow {
  return {
    commitment_id: commitmentId,
    night_date: night.nightDate,
    state: night.state,
    integrity: night.integrity,
    source_id: night.sourceId,
    wear_presence: night.wearPresence,
    deviation_min: night.deviationMin,
    frozen: night.frozen,
    device_clock_offset_min: deviceClockOffsetMin,
  };
}

/** Exactly the columns a commitment row may carry to the server (spec §8). */
export interface ServerCommitmentRow {
  readonly user_id: string;
  readonly bed_target_min: number;
  readonly wake_target_min: number;
  readonly tolerance_min: number;
}

/**
 * The commitment equivalent of `toServerRow`, and it exists for the same reason.
 *
 * DEF-005-02: the commitments insert was built inline at the call site from a
 * `StoredCommitment`, so it was the one write path in the app that was not a
 * whitelist. Nothing raw lives on a commitment today — but "today" is the whole
 * problem. `StoredCommitment` is a local type that will grow: a device id, a
 * last-synced timestamp, a nickname. Any of those would have been picked up by a
 * spread or an absent-minded `...local` and posted, and the guard would not have
 * stopped a plain integer or a short string.
 *
 * Constructive, like `toServerRow`: named fields copied one at a time, so a field
 * added to the source type cannot arrive here by accident.
 */
export function toServerCommitment(
  local: { bedTargetMin: number; wakeTargetMin: number; toleranceMin: number },
  userId: string,
): ServerCommitmentRow {
  return {
    user_id: userId,
    bed_target_min: local.bedTargetMin,
    wake_target_min: local.wakeTargetMin,
    tolerance_min: local.toleranceMin,
  };
}

/** The column names a commitment row is allowed to have. */
export const SERVER_COMMITMENT_COLUMNS: readonly string[] = [
  'user_id',
  'bed_target_min',
  'wake_target_min',
  'tolerance_min',
];

/** The column names a server row is allowed to have. Used by the export check. */
export const SERVER_ROW_COLUMNS: readonly string[] = [
  'commitment_id',
  'night_date',
  'state',
  'integrity',
  'source_id',
  'wear_presence',
  'deviation_min',
  'frozen',
  'device_clock_offset_min',
];
