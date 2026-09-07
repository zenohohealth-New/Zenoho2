/**
 * The member's sleep commitment (spec §4), stored on device (D-020).
 *
 * T-002 lets it be edited freely. D-006 and spec §6 restrict edits to a cycle
 * boundary, which cannot be enforced before cycles exist — that lock arrives with
 * T-004. Recorded here so the divergence is visible in the code, not only in the
 * task file.
 */
import type { Commitment, ToleranceMin } from '../derive/types';
import { getDb } from './db';

export const TOLERANCE_CHOICES: readonly ToleranceMin[] = [15, 30, 45, 60];

export interface StoredCommitment extends Commitment {
  readonly id: number;
  readonly createdAt: number;
}

interface CommitmentRow {
  id: number;
  bed_target_min: number;
  wake_target_min: number;
  tolerance_min: number;
  created_at: number;
}

const toCommitment = (r: CommitmentRow): StoredCommitment => ({
  id: r.id,
  bedTargetMin: r.bed_target_min,
  wakeTargetMin: r.wake_target_min,
  toleranceMin: r.tolerance_min as ToleranceMin,
  createdAt: r.created_at,
});

/** The active commitment, or null before one has ever been set. */
export async function loadCommitment(): Promise<StoredCommitment | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<CommitmentRow>(
    'SELECT * FROM commitments ORDER BY id DESC LIMIT 1;',
  );
  return row ? toCommitment(row) : null;
}

/**
 * Replace the commitment. A new row rather than an update, so the history of what
 * was promised is not silently rewritten — which matters once states reference a
 * commitment id.
 */
export async function saveCommitment(
  commitment: Commitment,
  nowMs: number = Date.now(),
): Promise<StoredCommitment> {
  if (!TOLERANCE_CHOICES.includes(commitment.toleranceMin)) {
    throw new Error(`Tolerance must be one of ${TOLERANCE_CHOICES.join(', ')}`);
  }
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO commitments (bed_target_min, wake_target_min, tolerance_min, created_at)
     VALUES (?, ?, ?, ?);`,
    [
      commitment.bedTargetMin,
      commitment.wakeTargetMin,
      commitment.toleranceMin,
      nowMs,
    ],
  );
  return { ...commitment, id: result.lastInsertRowId, createdAt: nowMs };
}
