/**
 * Local retention (T-001 constraint: "purge anything older than 45 days").
 *
 * Pure function over whatever the caller holds, so the policy is testable
 * without a storage engine. The storage engine itself lands with T-002.
 */
export const LOCAL_RETENTION_DAYS = 45;

export interface RetainableRecord {
  /** Epoch ms the record refers to (session start / sample time). */
  readonly atMs: number;
}

/** Keep only records newer than the retention horizon. */
export function purgeExpired<T extends RetainableRecord>(
  records: readonly T[],
  nowMs: number,
  retentionDays: number = LOCAL_RETENTION_DAYS,
): T[] {
  const horizon = nowMs - retentionDays * 24 * 60 * 60_000;
  return records.filter((r) => r.atMs >= horizon);
}

/** True when a record is past the retention horizon and must be dropped. */
export function isExpired(
  atMs: number,
  nowMs: number,
  retentionDays: number = LOCAL_RETENTION_DAYS,
): boolean {
  return atMs < nowMs - retentionDays * 24 * 60 * 60_000;
}
