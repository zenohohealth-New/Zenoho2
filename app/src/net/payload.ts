/**
 * The upload boundary (D-010, spec §7).
 *
 * `toServerRow` is the ONLY sanctioned way to turn a night into something that
 * may cross the network. It is a whitelist, not a redaction: it constructs a new
 * object from named fields, so a field added to `DerivedNight` later cannot leak
 * by accident.
 */
import type { DerivedNight } from '../derive/types';

/** Exactly the columns spec §7 permits the server to hold. */
export interface ServerDailyStateRow {
  readonly night_date: string;
  readonly state: string;
  readonly integrity: string;
  readonly source_id: string | null;
  readonly wear_presence: boolean;
  readonly deviation_min: number | null;
  readonly frozen: boolean;
}

export function toServerRow(night: DerivedNight): ServerDailyStateRow {
  return {
    night_date: night.nightDate,
    state: night.state,
    integrity: night.integrity,
    source_id: night.sourceId,
    wear_presence: night.wearPresence,
    deviation_min: night.deviationMin,
    frozen: night.frozen,
  };
}
