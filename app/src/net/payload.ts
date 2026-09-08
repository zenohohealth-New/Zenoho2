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
