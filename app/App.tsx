/**
 * T-001 device harness — not a product screen.
 *
 * Its only job is to produce the evidence R-001 has to report: that the health
 * bridge really reads from Health Connect on a physical device, what the real
 * dataOrigin strings are (a T-001 open item), and what the derivation makes of
 * last night. Pod, witness and cycle UI arrive in later tasks.
 *
 * Copy rule (spec §11): nothing here states a health benefit.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { deriveDailyState, localDateKey, type DeriveResult } from './src/derive';
import {
  checkEligibility,
  NO_WEARABLE_COPY,
  type EligibilityResult,
} from './src/eligibility';
import { getHealthStore, type PermissionOutcome } from './src/health';

/** Placeholder commitment for T-001: 23:00 to 06:30, 30-minute tolerance. */
const TRIAL_COMMITMENT = {
  bedTargetMin: 23 * 60,
  wakeTargetMin: 6 * 60 + 30,
  toleranceMin: 30,
} as const;

interface Probe {
  available: boolean | null;
  permission: PermissionOutcome | null;
  background: boolean | null;
  nightDate: string | null;
  sessionCount: number | null;
  hrCount: number | null;
  /** Distinct dataOrigin strings seen on this device — the open item to record. */
  origins: string[];
  eligibility: EligibilityResult | null;
  derived: DeriveResult | null;
  error: string | null;
}

const EMPTY: Probe = {
  available: null,
  permission: null,
  background: null,
  nightDate: null,
  sessionCount: null,
  hrCount: null,
  origins: [],
  eligibility: null,
  derived: null,
  error: null,
};

export default function App() {
  const [probe, setProbe] = useState<Probe>(EMPTY);
  const [busy, setBusy] = useState(false);

  const tzOffsetMin = useMemo(() => -new Date().getTimezoneOffset(), []);

  const run = useCallback(async () => {
    setBusy(true);
    setProbe(EMPTY);
    try {
      const store = getHealthStore();

      const available = await store.isAvailable();
      if (!available) {
        setProbe({ ...EMPTY, available: false });
        return;
      }

      const permission = await store.requestReadPermissions();
      if (permission !== 'GRANTED') {
        setProbe({ ...EMPTY, available: true, permission });
        return;
      }

      const background = await store.hasBackgroundAccess();
      const now = Date.now();
      const nightDate = localDateKey(now, tzOffsetMin);
      const { sessions, hr } = await store.readNight(nightDate, tzOffsetMin);

      const origins = Array.from(
        new Set([...sessions.map((s) => s.sourceId), ...hr.map((h) => h.sourceId)]),
      ).filter(Boolean);

      const eligibility = checkEligibility(sessions, hr, store.platform, now);
      const derived = deriveDailyState(
        {
          nightDate,
          commitment: TRIAL_COMMITMENT,
          sessions,
          hr,
          tzOffsetMin,
        },
        store.platform,
        now,
      );

      setProbe({
        available: true,
        permission,
        background,
        nightDate,
        sessionCount: sessions.length,
        hrCount: hr.length,
        origins,
        eligibility,
        derived,
        error: null,
      });
    } catch (e) {
      setProbe({ ...EMPTY, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [tzOffsetMin]);

  useEffect(() => {
    void run();
  }, [run]);

  const d = probe.derived?.night;

  return (
    <View style={styles.screen}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h1}>Zenoho2 · T-001 harness</Text>
        <Text style={styles.sub}>
          {Platform.OS} · UTC offset {tzOffsetMin} min
        </Text>

        <Row label="Health store available" value={fmt(probe.available)} />
        <Row label="Read permission" value={probe.permission ?? '—'} />
        <Row label="Background read granted" value={fmt(probe.background)} />
        <Row label="Night date" value={probe.nightDate ?? '—'} />
        <Row label="Sleep sessions read" value={fmt(probe.sessionCount)} />
        <Row label="HR samples read" value={fmt(probe.hrCount)} />

        <Text style={styles.h2}>Source origins seen</Text>
        {probe.origins.length === 0 ? (
          <Text style={styles.mono}>—</Text>
        ) : (
          probe.origins.map((o) => (
            <Text key={o} style={styles.mono}>
              {o}
            </Text>
          ))
        )}

        <Text style={styles.h2}>Eligibility</Text>
        <Row label="Outcome" value={probe.eligibility?.outcome ?? '—'} />
        <Row label="Brand unverified" value={fmt(probe.eligibility?.brandUnverified)} />
        {probe.eligibility?.outcome === 'NO_WEARABLE_SOURCE' && (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>{NO_WEARABLE_COPY.title}</Text>
            <Text style={styles.noticeBody}>{NO_WEARABLE_COPY.body}</Text>
          </View>
        )}

        <Text style={styles.h2}>Derived night</Text>
        <Row label="State" value={d?.state ?? '—'} />
        <Row label="Integrity" value={d?.integrity ?? '—'} />
        <Row label="Wear presence" value={fmt(d?.wearPresence)} />
        <Row label="Deviation (min)" value={fmt(d?.deviationMin)} />
        <Row
          label="Wear ratio"
          value={
            probe.derived ? `${Math.round(probe.derived.wearRatio * 100)}%` : '—'
          }
        />

        {probe.error !== null && (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Error</Text>
            <Text style={styles.mono}>{probe.error}</Text>
          </View>
        )}

        <Pressable style={styles.button} onPress={run} disabled={busy}>
          <Text style={styles.buttonText}>{busy ? 'Reading…' : 'Read again'}</Text>
        </Pressable>

        <Text style={styles.footnote}>
          Sleep and heart-rate values read here stay on this device. Nothing is
          uploaded in T-001.
        </Text>
      </ScrollView>
    </View>
  );
}

function fmt(v: boolean | number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#faf9f7' },
  content: { padding: 20, paddingTop: 64, gap: 2 },
  h1: { fontSize: 20, fontWeight: '600', color: '#1a1a1a' },
  sub: { fontSize: 13, color: '#6b6b6b', marginBottom: 16 },
  h2: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b6b6b',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 20,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e0dc',
    gap: 12,
  },
  rowLabel: { fontSize: 15, color: '#3a3a3a', flexShrink: 1 },
  rowValue: { fontSize: 15, color: '#1a1a1a', fontWeight: '500' },
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 12,
    color: '#1a1a1a',
    paddingVertical: 2,
  },
  notice: {
    backgroundColor: '#fff4e5',
    borderRadius: 10,
    padding: 14,
    marginTop: 12,
    gap: 6,
  },
  noticeTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  noticeBody: { fontSize: 14, color: '#3a3a3a', lineHeight: 20 },
  button: {
    marginTop: 28,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  footnote: { fontSize: 12, color: '#6b6b6b', marginTop: 20, lineHeight: 18 },
});
