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
import { ActivityIndicator, Text, View } from 'react-native';
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
import { CommitmentScreen } from './src/ui/CommitmentScreen';
import { HistoryScreen } from './src/ui/HistoryScreen';
import { HarnessScreen } from './src/ui/HarnessScreen';
import { colors, t } from './src/ui/theme';

/** Spec §4 default tolerance. The times are a starting point, not advice. */
const STARTING_COMMITMENT: Commitment = {
  bedTargetMin: 23 * 60,
  wakeTargetMin: 7 * 60,
  toleranceMin: DEFAULT_TOLERANCE_MIN,
};

const rhrLocalStore = new SqliteRhrHistoryStore();

type Route = 'loading' | 'commitment' | 'history' | 'harness';

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
  const sync = useCallback(
    async (c: StoredCommitment) => {
      setBusy(true);
      setError(null);
      try {
        const store = getHealthStore();
        if ((await store.requestReadPermissions()) !== 'GRANTED') {
          setError(
            'Zenoho needs permission to read sleep and heart rate from Health Connect.',
          );
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
        } else if (outcome.readErrors.length > 0) {
          setError(outcome.readErrors.map((e) => `${e.kind}: ${e.message}`).join('\n'));
        }

        await refreshSummary(c.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [tzOffsetMin, refreshSummary],
  );

  // Boot: load the commitment, then either ask for one or show the history.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const existing = await loadCommitment();
        if (cancelled) return;
        if (existing === null) {
          setRoute('commitment');
          return;
        }
        setCommitment(existing);
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

  if (route === 'loading') {
    return (
      <View style={[t.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar style="auto" />
        <ActivityIndicator color={colors.ink} />
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
        onRefresh={() => void sync(commitment)}
        onEditCommitment={() => setRoute('commitment')}
        onOpenHarness={() => setRoute('harness')}
      />
    </View>
  );
}
