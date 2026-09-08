/**
 * Sync: push derived nights to the server (T-003 deliverable 4).
 *
 * The server is a mirror. Local SQLite remains the source of truth for display in
 * v1, so a failed or delayed sync never changes what the member sees — it only
 * delays what a witness would see once T-004 exists.
 */
import type { DerivedNight } from '../derive/types';
import type { StoredCommitment } from '../storage/commitmentStore';
import { KEY_REMOTE_COMMITMENT_ID, kvGetNumber, kvSetNumber } from '../storage/kv';
import { toServerRow, type ServerDailyStateRow } from '../net/payload';
import { getSupabase } from './client';
import { getDeviceClockOffsetMin } from './clockSkew';
import { clearQueue, enqueue, markFailed, markSent, pending, pendingCount } from './syncQueue';

/** Ask the server for its own clock (migration 0001 defines `server_now`). */
async function serverNow(): Promise<{ serverMs: number }> {
  const { data, error } = await getSupabase().rpc('server_now');
  if (error) throw new Error(error.message);
  return { serverMs: Date.parse(String(data)) };
}

/**
 * Ensure the signed-in user has a row and a server-side commitment, and return
 * that commitment's id. Cached locally so this is one round trip, not one a night.
 */
export async function ensureRemoteCommitment(
  local: StoredCommitment,
): Promise<number> {
  const cached = await kvGetNumber(KEY_REMOTE_COMMITMENT_ID);
  if (cached !== null) return cached;

  const supabase = getSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('not signed in');

  // The users row is upserted rather than inserted: signing in on a second device
  // must not fail on a row that already exists.
  const { error: userErr } = await supabase
    .from('users')
    .upsert({ id: userId, platform: 'android' }, { onConflict: 'id' });
  if (userErr) throw new Error(userErr.message);

  const { data, error } = await supabase
    .from('commitments')
    .insert({
      user_id: userId,
      bed_target_min: local.bedTargetMin,
      wake_target_min: local.wakeTargetMin,
      tolerance_min: local.toleranceMin,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  const id = Number(data.id);
  await kvSetNumber(KEY_REMOTE_COMMITMENT_ID, id);
  return id;
}

/**
 * The commitment id a night carries while it is still only local.
 *
 * A night derived in a basement has no server commitment id, because obtaining
 * one is a round trip. The real id is stamped at drain time, when there is a
 * network to stamp it from. Zero is never a real id — Postgres identities start
 * at one — so a row that still carries it has provably never been uploaded.
 */
export const UNSTAMPED_COMMITMENT_ID = 0;

/**
 * Queue a derived night for upload. **Local only: this touches no network.**
 *
 * DEF-003-01 / AC-3.6: this used to be called from inside `if (data.user)`, and
 * `auth.getUser()` is a round trip to `/auth/v1/user`. Offline that call rejects,
 * the caller's catch swallowed it, and the night was never queued at all — so
 * "queue locally, retry on next foreground" could not work, because nothing was
 * ever queued. Queueing is now unconditional and synchronous with derivation.
 *
 * `commitment_id` and `device_clock_offset_min` are both stamped at drain: the
 * first needs the server, the second needs a clock probe. Neither is part of the
 * verdict, so neither can change what was derived on device.
 */
export async function queueNight(night: DerivedNight): Promise<void> {
  await enqueue(toServerRow(night, UNSTAMPED_COMMITMENT_ID, null));
}

export interface DrainResult {
  readonly sent: number;
  readonly failed: number;
  readonly remaining: number;
  /** Set when the drain stopped early — offline, signed out, or refused. */
  readonly stoppedBecause: string | null;
}

/**
 * Push everything pending. Called on foreground (AC-R3) and after each
 * derivation when online.
 *
 * Stops at the first failure rather than hammering a dead network: the queue is
 * ordered by night and the next foreground will try again. A row is only removed
 * once the server has acknowledged it, so a drain interrupted halfway leaves the
 * rest queued rather than lost.
 *
 * Idempotent (AC-R7). The upsert is on `(commitment_id, night_date)`, so
 * re-draining a night the server already has updates that one row and inserts
 * nothing. Draining an empty queue is a no-op that reports success.
 *
 * Never throws: offline is the expected case, not an exception. The caller gets
 * a `stoppedBecause` string and decides whether it is worth showing.
 */
export async function drainQueue(
  local?: StoredCommitment,
): Promise<DrainResult> {
  const rows = await pending();
  if (rows.length === 0) {
    return { sent: 0, failed: 0, remaining: 0, stoppedBecause: null };
  }

  const stop = (why: string): DrainResult => ({
    sent: 0,
    failed: 0,
    remaining: rows.length,
    stoppedBecause: why,
  });

  let supabase;
  try {
    supabase = getSupabase();
  } catch {
    return stop('backend not configured');
  }

  // getSession reads local storage; getUser is a round trip. Offline the round
  // trip is exactly what we are avoiding, so ask the cheap question.
  let session;
  try {
    const { data } = await supabase.auth.getSession();
    session = data.session;
  } catch (e) {
    return stop(e instanceof Error ? e.message : 'could not read session');
  }
  if (!session) return stop('not signed in');

  // The two fields the queue could not know on device. Both are stamped here,
  // where a network exists; neither is part of the derived verdict.
  let commitmentId: number;
  let offset: number | null;
  try {
    if (local === undefined) return stop('no local commitment');
    commitmentId = await ensureRemoteCommitment(local);
    offset = await getDeviceClockOffsetMin(serverNow);
  } catch (e) {
    return stop(e instanceof Error ? e.message : 'could not reach the server');
  }

  let sent = 0;
  let failed = 0;
  let stoppedBecause: string | null = null;

  for (const row of rows) {
    const payload: ServerDailyStateRow = {
      ...row.payload,
      commitment_id: commitmentId,
      device_clock_offset_min: offset,
    };

    const { error } = await supabase
      .from('daily_states')
      .upsert(payload, { onConflict: 'commitment_id,night_date' });

    if (error) {
      failed += 1;
      await markFailed(row.nightDate, error.message);
      stoppedBecause = error.message;
      break;
    }
    await markSent(row.nightDate);
    sent += 1;
  }

  return { sent, failed, remaining: await pendingCount(), stoppedBecause };
}

/** AC-3.7: the user's own server rows, for export. */
export async function exportOwnRows(): Promise<unknown[]> {
  const { data, error } = await getSupabase()
    .from('daily_states')
    .select('*')
    .order('night_date', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * AC-3.8: hard-delete everything for the caller, then wipe local state.
 *
 * The delete itself runs in an edge function holding the service-role key, so the
 * app never carries a key that can bypass RLS. Idempotent by construction: the
 * function deletes by user id and deleting nothing is not an error.
 */
export async function deleteAccount(): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.functions.invoke('delete-account');
  if (error) throw new Error(error.message);

  await clearQueue();
  await supabase.auth.signOut();
}
