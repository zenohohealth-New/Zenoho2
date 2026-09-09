/**
 * T-002 — the local nightly engine, as an app.
 *
 * No server, no account, no network. On open it loads the commitment from SQLite,
 * derives last night, and shows the history. First run backfills the last 30
 * nights so there is something to look at immediately.
 *
 * Copy rule (spec §11) applies to every string reachable from here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, Share, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { localDateKey } from './src/derive';
import type { Commitment, DerivedNight } from './src/derive/types';
import { DEFAULT_TOLERANCE_MIN } from './src/derive/types';
import { getHealthStore } from './src/health';
import { SqliteRhrHistoryStore } from './src/storage/sqliteRhrStore';
import {
  loadCommitment,
  saveCommitment,
  type StoredCommitment,
} from './src/storage/commitmentStore';
import { countNights } from './src/storage/dailyStateStore';
import {
  backfill,
  deriveAndStoreNight,
  summariseHistory,
} from './src/engine/nightlyEngine';
import * as Notifications from 'expo-notifications';
import {
  recordMorningSyncFired,
  requestNotificationPermission,
  scheduleMorningSync,
} from './src/engine/morningSync';
import { getSupabase, readBackendEnv } from './src/backend/client';
import {
  deleteAccount,
  drainQueue,
  exportOwnRows,
  queueNight,
} from './src/backend/sync';
import { pendingCount } from './src/backend/syncQueue';
import { KEY_CLOCK_OFFSET_MIN, kvGetNumber } from './src/storage/kv';
import { NO_DATA_HINT } from './src/eligibility';
import { CommitmentScreen } from './src/ui/CommitmentScreen';
import { SignInScreen } from './src/ui/SignInScreen';
import { SettingsScreen } from './src/ui/SettingsScreen';
import { HistoryScreen, STATE_LABEL } from './src/ui/HistoryScreen';
import { HarnessScreen } from './src/ui/HarnessScreen';
import { colors, t } from './src/ui/theme';

/** Spec §4 default tolerance. The times are a starting point, not advice. */
const STARTING_COMMITMENT: Commitment = {
  bedTargetMin: 23 * 60,
  wakeTargetMin: 7 * 60,
  toleranceMin: DEFAULT_TOLERANCE_MIN,
};

const rhrLocalStore = new SqliteRhrHistoryStore();

type Route = 'loading' | 'signin' | 'commitment' | 'history' | 'harness' | 'settings';

/** True when the backend env is filled in. Absent env keeps the app local-only. */
function backendConfigured(): boolean {
  try {
    readBackendEnv();
    return true;
  } catch {
    return false;
  }
}

export default function App() {
  const [route, setRoute] = useState<Route>('loading');
  const [commitment, setCommitment] = useState<StoredCommitment | null>(null);
  const [nights, setNights] = useState<readonly DerivedNight[]>([]);
  const [streak, setStreak] = useState(0);
  const [lifetimeKept, setLifetimeKept] = useState(0);
  const [promptDeviceCheck, setPromptDeviceCheck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  /**
   * The result of the last "Check last night" tap, shown next to the button.
   *
   * DEF-003-01: offline, a tap appeared to do nothing. Every other piece of
   * feedback on this screen — the verdict, the error banner — renders at the top
   * of a scroll view that is thirty rows tall, so from the button they are all
   * off-screen. Feedback about a control has to live next to that control.
   */
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [pendingSync, setPendingSync] = useState(0);
  const [clockOffsetMin, setClockOffsetMin] = useState<number | null>(null);

  const tzOffsetMin = useMemo(() => -new Date().getTimezoneOffset(), []);

  const refreshSummary = useCallback(async (commitmentId: number) => {
    const s = await summariseHistory(commitmentId);
    setNights(s.nights);
    setStreak(s.streak);
    setLifetimeKept(s.lifetimeKept);
    setPromptDeviceCheck(s.promptDeviceCheck);
  }, []);

  /**
   * Derive last night, backfilling first when the store is empty. Read failures
   * are shown, never swallowed into a NO_DATA — a failed read is not a missed night.
   */
  /**
   * Push whatever is queued. Best-effort and silent about ordinary failure:
   * offline is a normal state, not an error worth a banner.
   */
  const pushPending = useCallback(async (c: StoredCommitment | null) => {
    const r = await drainQueue(c ?? undefined);
    setPendingSync(await pendingCount());
    setClockOffsetMin(await kvGetNumber(KEY_CLOCK_OFFSET_MIN));
    return r;
  }, []);

  /**
   * Derive last night, backfilling first when the store is empty.
   *
   * Local-first, and that ordering is the point (D-010). Health Connect is on the
   * phone, the promise is in SQLite, the verdict is computed here — so a verdict
   * is produced, stored and displayed with no network at all. Upload is a separate
   * step afterwards that can fail freely without touching any of it.
   *
   * Read failures are shown, never swallowed into a NO_DATA — a failed read is not
   * a missed night. And every path through this function sets `checkNote`, so a
   * tap always changes something the user can see next to the button.
   */
  const sync = useCallback(
    async (c: StoredCommitment) => {
      setBusy(true);
      setError(null);
      setCheckNote(null);
      let note = 'Finished.';
      try {
        const store = getHealthStore();
        if ((await store.requestReadPermissions()) !== 'GRANTED') {
          setError(
            'Zenoho needs permission to read sleep and heart rate from Health Connect.',
          );
          note = 'Health Connect permission is not granted — nothing was read.';
          return;
        }

        const nowMs = Date.now();
        const base = {
          store,
          rhrLocalStore,
          commitmentId: c.id,
          commitment: c,
          tzOffsetMin,
          nowMs,
        };

        if ((await countNights(c.id)) === 0) {
          await backfill(base);
        }

        const outcome = await deriveAndStoreNight({
          ...base,
          nightDate: localDateKey(nowMs, tzOffsetMin),
        });

        if (outcome === null) {
          setError("Couldn't read sleep from Health Connect, so nothing was recorded.");
          note = "Couldn't read sleep — nothing was recorded for last night.";
        } else if (outcome.readErrors.length > 0) {
          setError(outcome.readErrors.map((e) => `${e.kind}: ${e.message}`).join('\n'));
          note = 'Read partly failed — see the note at the top of this screen.';
        } else {
          note = `Last night: ${STATE_LABEL[outcome.stored.state] ?? outcome.stored.state}.`;
          if (outcome.stored.state === 'NO_DATA') note += ` ${NO_DATA_HINT}`;
        }

        await refreshSummary(c.id);

        // Queue unconditionally, before anything that could need a network. This
        // is the DEF-003-01 fix: queueing used to sit behind `auth.getUser()`,
        // a round trip, so a night derived offline was never queued at all.
        if (outcome !== null && backendConfigured()) {
          await queueNight(outcome.stored);
          const r = await pushPending(c);
          if (r.remaining > 0) {
            note += ` Saved on this phone; ${r.remaining} night${
              r.remaining === 1 ? '' : 's'
            } waiting to upload.`;
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        note = `Something went wrong: ${message}`;
      } finally {
        setCheckNote(note);
        setBusy(false);
      }
    },
    [tzOffsetMin, refreshSummary, pushPending],
  );

  // Boot: recover the session, load the commitment, and route.
  //
  // Spec §11 screen 1: a signed-out user lands on sign-in. Signing in is
  // skippable — the app works entirely on-device without an account — but it must
  // be offered rather than hidden, which is the defect this replaces.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const existing = await loadCommitment();
        if (cancelled) return;
        setCommitment(existing);

        // Recover a persisted session so Settings knows who is signed in, and so
        // a returning user is not asked again (AC-3.1).
        let session = null;
        let sessionKnown = false;
        if (backendConfigured()) {
          try {
            const { data, error } = await getSupabase().auth.getSession();
            session = data.session;
            // `error` matters as much as the throw, and this is the case T-003-R
            // got wrong. supabase-js does not throw when it cannot refresh: with
            // an expired access token and no network it RETURNS
            // `{ session: null, error: AuthRetryableFetchError }`. Reading only
            // `data` therefore looked exactly like "signed out", and a signed-in
            // member opening the app offline an hour after their last refresh
            // would have been thrown back to the sign-in screen — the very
            // failure `sessionKnown` was added to prevent.
            sessionKnown = error === null;
            if (session?.user.email) setEmail(session.user.email);
          } catch {
            // Backend unreachable or misconfigured: the app is still fully usable
            // on-device, so this must not block boot. sessionKnown stays false.
          }
        }

        // Only route to sign-in when we positively know there is no session.
        // Offline, `getSession` can fail to confirm one, and treating "couldn't
        // check" as "signed out" would throw a signed-in user back to sign-in
        // every time they opened the app without a network.
        if (backendConfigured() && sessionKnown && session === null) {
          setRoute('signin');
          return;
        }
        if (existing === null) {
          setRoute('commitment');
          return;
        }

        setRoute('history');
        await refreshSummary(existing.id);

        // Re-arm on every open: a schedule can be lost to a force-stop or to
        // cleared app data, and nothing else would ever put it back.
        void Notifications.getPermissionsAsync().then((p) => {
          if (p.granted) void scheduleMorningSync(existing.wakeTargetMin);
        });

        await sync(existing);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setRoute('commitment');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSummary, sync]);

  /**
   * Drain the queue whenever the app comes to the foreground (AC-R3, deliverable 4).
   *
   * This is the only lifecycle handling in the app and deliberately the smallest
   * thing that satisfies the requirement: one `AppState` listener, no navigation
   * library, no background task, no scheduler. A night derived in airplane mode
   * uploads the next time the app is opened with a network, without a tap.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void pushPending(commitment);
    });
    return () => sub.remove();
  }, [pushPending, commitment]);

  // Record when the trigger actually fires. Both listeners matter: `received`
  // covers a foreground delivery, `response` covers the user tapping it.
  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(() => {
      void recordMorningSyncFired();
    });
    const responded = Notifications.addNotificationResponseReceivedListener(() => {
      void recordMorningSyncFired();
    });
    return () => {
      received.remove();
      responded.remove();
    };
  }, []);

  const handleSave = useCallback(
    async (c: Commitment) => {
      setSaving(true);
      try {
        const stored = await saveCommitment(c);
        setCommitment(stored);
        // Spec §10: one local trigger a day, at wake_target + 60 min.
        if ((await requestNotificationPermission()) === 'GRANTED') {
          await scheduleMorningSync(stored.wakeTargetMin);
        }
        setRoute('history');
        await refreshSummary(stored.id);
        await sync(stored);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [refreshSummary, sync],
  );

  const sendCode = useCallback(async (addr: string) => {
    const { error: e } = await getSupabase().auth.signInWithOtp({
      email: addr,
      options: { shouldCreateUser: true },
    });
    if (e) throw new Error(e.message);
  }, []);

  const verifyCode = useCallback(
    async (addr: string, code: string) => {
      const { error: e } = await getSupabase().auth.verifyOtp({
        email: addr,
        token: code,
        type: 'email',
      });
      if (e) throw new Error(e.message);
      setEmail(addr);
      setRoute(commitment === null ? 'commitment' : 'history');
      if (commitment !== null) await sync(commitment);
    },
    [commitment, sync],
  );

  const handleExport = useCallback(async () => {
    const rows = await exportOwnRows();
    await Share.share({
      title: 'Zenoho data export',
      message: JSON.stringify(rows, null, 2),
    });
  }, []);

  const handleSignOut = useCallback(async () => {
    await getSupabase().auth.signOut();
    setEmail(null);
    setPendingSync(0);
    setRoute('signin');
  }, []);

  const handleDelete = useCallback(async () => {
    await deleteAccount();
    setEmail(null);
    setCommitment(null);
    setNights([]);
    setRoute('signin');
  }, []);

  if (route === 'loading') {
    return (
      <View style={[t.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="auto" />
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  if (route === 'signin') {
    return (
      <View style={t.screen}>
        <StatusBar style="auto" />
        <SignInScreen
          onSendCode={sendCode}
          onVerify={verifyCode}
          onSkip={() => setRoute(commitment === null ? 'commitment' : 'history')}
        />
      </View>
    );
  }

  // Settings is about the account, not the promise, so it must not require a
  // commitment. Gating it on one left a signed-out user with no commitment
  // falling through to an endless spinner (found in the D-038 cold-install pass).
  if (route === 'settings') {
    return (
      <View style={t.screen}>
        <StatusBar style="auto" />
        <SettingsScreen
          email={email}
          pendingSync={pendingSync}
          clockOffsetMin={clockOffsetMin}
          onSignOut={handleSignOut}
          onExport={handleExport}
          onDelete={handleDelete}
          onSignIn={() => setRoute('signin')}
          onClose={() => setRoute('history')}
        />
      </View>
    );
  }

  if (route === 'commitment') {
    return (
      <View style={t.screen}>
        <StatusBar style="auto" />
        {error !== null && (
          <View style={[t.notice, { margin: 20, marginBottom: 0 }]}>
            <Text style={t.noticeBody}>{error}</Text>
          </View>
        )}
        <CommitmentScreen
          initial={commitment ?? STARTING_COMMITMENT}
          saving={saving}
          onSave={handleSave}
          onCancel={commitment ? () => setRoute('history') : undefined}
        />
      </View>
    );
  }

  if (commitment === null) {
    return (
      <View style={[t.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="auto" />
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  if (route === 'harness') {
    return (
      <View style={t.screen}>
        <StatusBar style="auto" />
        <HarnessScreen
          commitment={commitment}
          commitmentId={commitment.id}
          onClose={() => setRoute('history')}
        />
      </View>
    );
  }

  return (
    <View style={t.screen}>
      <StatusBar style="auto" />
      <HistoryScreen
        commitment={commitment}
        nights={nights}
        streak={streak}
        lifetimeKept={lifetimeKept}
        promptDeviceCheck={promptDeviceCheck}
        busy={busy}
        error={error}
        checkNote={checkNote}
        pendingSync={pendingSync}
        onRefresh={() => void sync(commitment)}
        onEditCommitment={() => setRoute('commitment')}
        onOpenHarness={() => setRoute('harness')}
        onOpenSettings={() => setRoute('settings')}
      />
    </View>
  );
}
