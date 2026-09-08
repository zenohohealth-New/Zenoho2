/**
 * The T-001 diagnostic harness, retained per D-022 as the brand-verification tool
 * and reached by long-pressing the Zenoho title. Not a product screen.
 *
 * It also carries the T-002 acceptance diagnostics that cannot be proven any other
 * way on a device: forcing the D-017 fallback so the D-020 SQLite write path
 * executes (AC-2.4), and seeding an old row to watch retention delete it (AC-2.5).
 *
 * Copy rule (spec §11) applies here too, though nothing on this screen makes a
 * claim of any kind.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';

import {
  deriveDailyState,
  localDateKey,
  localMinuteOfDay,
  selectMainSession,
  type DeriveResult,
} from '../derive';
import type { Commitment } from '../derive/types';
import { checkEligibility, NO_WEARABLE_COPY, type EligibilityResult } from '../eligibility';
import { getHealthStore, type PermissionOutcome, type ReadIssue } from '../health';
import { loadRhrHistory } from '../health/rhrHistory';
import { SqliteRhrHistoryStore } from '../storage/sqliteRhrStore';
import { countNights, purgeOldStates, putNight } from '../storage/dailyStateStore';
import { morningSyncStatus, type MorningSyncStatus } from '../engine/morningSync';
import { colors, t } from './theme';

interface Probe {
  available: boolean | null;
  permission: PermissionOutcome | null;
  background: boolean | null;
  nightDate: string | null;
  sessionCount: number | null;
  hrCount: number | null;
  origins: string[];
  eligibility: EligibilityResult | null;
  derived: DeriveResult | null;
  rhrNights: number | null;
  rhrFallback: boolean | null;
  hrSpan: string | null;
  sessionSpan: string | null;
  readErrors: ReadIssue[];
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
  rhrNights: null,
  rhrFallback: null,
  hrSpan: null,
  sessionSpan: null,
  readErrors: [],
  error: null,
};

const rhrLocalStore = new SqliteRhrHistoryStore();

interface Props {
  readonly commitment: Commitment;
  readonly commitmentId: number;
  readonly onClose: () => void;
}

export function HarnessScreen({ commitment, commitmentId, onClose }: Props) {
  const [probe, setProbe] = useState<Probe>(EMPTY);
  const [busy, setBusy] = useState(true);
  const [forceFallback, setForceFallback] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [sync, setSync] = useState<MorningSyncStatus | null>(null);

  const tzOffsetMin = useMemo(() => -new Date().getTimezoneOffset(), []);
  const say = useCallback(
    (line: string) => setLog((prev) => [...prev.slice(-9), line]),
    [],
  );

  const probeOnce = useCallback(async (): Promise<Probe> => {
    try {
      const store = getHealthStore();

      const available = await store.isAvailable();
      if (!available) return { ...EMPTY, available: false };

      const permission = await store.requestReadPermissions();
      if (permission !== 'GRANTED') return { ...EMPTY, available: true, permission };

      const background = await store.hasBackgroundAccess();
      const now = Date.now();
      const nightDate = localDateKey(now, tzOffsetMin);
      const { sessions, hr, readErrors } = await store.readNight(nightDate, tzOffsetMin);

      const origins = Array.from(
        new Set([...sessions.map((s) => s.sourceId), ...hr.map((h) => h.sourceId)]),
      ).filter(Boolean);

      const eligibility = checkEligibility(sessions, hr, store.platform, now);
      const main = selectMainSession(sessions, nightDate, tzOffsetMin, store.platform);

      const rhr = await loadRhrHistory(
        store,
        rhrLocalStore,
        nightDate,
        tzOffsetMin,
        hr,
        main?.session.startMs ?? null,
        main?.session.endMs ?? null,
        undefined,
        forceFallback,
      );

      const derived = deriveDailyState(
        {
          nightDate,
          commitment,
          sessions,
          hr,
          tzOffsetMin,
          rhrHistory: rhr.history,
        },
        store.platform,
        now,
      );

      return {
        available: true,
        permission,
        background,
        nightDate,
        sessionCount: sessions.length,
        hrCount: hr.length,
        origins,
        eligibility,
        derived,
        rhrNights: rhr.history.length,
        rhrFallback: rhr.usedFallback,
        hrSpan: spanOf(hr.map((h) => h.atMs), tzOffsetMin),
        sessionSpan:
          main === null
            ? null
            : spanOf([main.session.startMs, main.session.endMs], tzOffsetMin),
        readErrors:
          rhr.storeError === null
            ? readErrors
            : [...readErrors, { kind: 'rhr' as const, message: rhr.storeError }],
        error: null,
      };
    } catch (e) {
      return { ...EMPTY, error: e instanceof Error ? e.message : String(e) };
    }
  }, [tzOffsetMin, commitment, forceFallback]);

  useEffect(() => {
    let cancelled = false;
    void probeOnce().then((result) => {
      if (cancelled) return;
      setProbe(result);
      setBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [probeOnce]);

  const rerun = useCallback(() => {
    setBusy(true);
    setProbe(EMPTY);
    void probeOnce().then((result) => {
      setProbe(result);
      setBusy(false);
    });
  }, [probeOnce]);

  /** AC-2.5: seed a row older than the horizon and watch retention remove it. */
  const testRetention = useCallback(async () => {
    const before = await countNights(commitmentId);
    const old = localDateKey(Date.now() - 60 * 86_400_000, tzOffsetMin);
    await putNight(commitmentId, {
      nightDate: old,
      state: 'NO_DATA',
      integrity: 'NO_SOURCE',
      sourceId: null,
      wearPresence: false,
      deviationMin: null,
      computedAt: Date.now(),
      frozen: true,
      revisionCount: 0,
    });
    const seeded = await countNights(commitmentId);
    const purged = await purgeOldStates();
    const after = await countNights(commitmentId);
    say(`retention: ${before} → seeded ${seeded} (${old}) → purged ${purged} → ${after}`);
  }, [commitmentId, tzOffsetMin, say]);

  // Button handler: a direct setState here is fine, it is not an effect body.
  const refreshSyncStatus = useCallback(() => {
    void morningSyncStatus().then(setSync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void morningSyncStatus().then((s) => {
      if (!cancelled) setSync(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const d = probe.derived?.night;
  const sleepReadFailed = probe.readErrors.some((e) => e.kind === 'sleep');

  return (
    <ScrollView style={t.screen} contentContainerStyle={t.content}>
      <Text style={t.h1}>Diagnostics</Text>
      <Text style={t.sub}>
        {Platform.OS} · UTC offset {tzOffsetMin} min · commitment #{commitmentId}
      </Text>

      <Text style={t.h2}>Health store</Text>
      <Row label="Available" value={fmt(probe.available)} />
      <Row label="Read permission" value={probe.permission ?? '—'} />
      <Row label="Background read granted" value={fmt(probe.background)} />
      <Row label="Night date" value={probe.nightDate ?? '—'} />
      <Row label="Sleep sessions read" value={fmt(probe.sessionCount)} />
      <Row label="HR samples read" value={fmt(probe.hrCount)} />
      <Row label="HR span (local)" value={probe.hrSpan ?? '—'} />
      <Row label="Main session (local)" value={probe.sessionSpan ?? '—'} />

      <Text style={t.h2}>Source origins seen</Text>
      {probe.origins.length === 0 ? (
        <Text style={t.mono}>—</Text>
      ) : (
        probe.origins.map((o) => (
          <Text key={o} style={t.mono}>
            {o}
          </Text>
        ))
      )}

      <Text style={t.h2}>Eligibility</Text>
      <Row label="Outcome" value={probe.eligibility?.outcome ?? '—'} />
      <Row label="Brand unverified" value={fmt(probe.eligibility?.brandUnverified)} />
      {probe.eligibility?.outcome === 'NO_WEARABLE_SOURCE' && (
        <View style={t.notice}>
          <Text style={t.noticeTitle}>{NO_WEARABLE_COPY.title}</Text>
          <Text style={t.noticeBody}>{NO_WEARABLE_COPY.body}</Text>
        </View>
      )}

      {probe.readErrors.length > 0 && (
        <View style={t.notice}>
          <Text style={t.noticeTitle}>Some reads failed</Text>
          <Text style={t.noticeBody}>
            The rows below are computed from whatever did come back. A failed read is
            not the same as a quiet night, so this is not a real result.
          </Text>
          {probe.readErrors.map((e) => (
            <Text key={`${e.kind}:${e.message}`} style={t.mono}>
              {e.kind}: {e.message}
            </Text>
          ))}
        </View>
      )}

      <Text style={t.h2}>Derived night</Text>
      <Row label="State" value={sleepReadFailed ? 'not computed' : d?.state ?? '—'} />
      <Row label="Integrity" value={sleepReadFailed ? 'not computed' : d?.integrity ?? '—'} />
      <Row label="Wear presence" value={fmt(d?.wearPresence)} />
      <Row label="Deviation (min)" value={fmt(d?.deviationMin)} />
      <Row
        label="Wear ratio"
        value={probe.derived ? `${Math.round(probe.derived.wearRatio * 100)}%` : '—'}
      />
      <Row label="RHR nights available" value={fmt(probe.rhrNights)} />
      <Row label="RHR from fallback" value={fmt(probe.rhrFallback)} />

      <Text style={t.h2}>Morning sync</Text>
      <Row label="Triggers armed" value={sync === null ? '—' : String(sync.scheduledCount)} />
      <Row label="Next scheduled sync" value={stamp(sync?.nextAtMs ?? null)} />
      <Row label="Last fired" value={stamp(sync?.lastFiredMs ?? null)} />
      <Row label="Verdict" value={sync?.verdict.state ?? '—'} />
      {sync !== null && sync.verdict.state === 'MISSED' && (
        <View style={t.notice}>
          <Text style={t.noticeTitle}>The reminder did not arrive</Text>
          <Text style={t.noticeBody}>
            Android may hold back or drop a scheduled reminder when battery use is
            restricted. Nothing is lost — opening Zenoho any time in the day works
            out the night just the same.
          </Text>
        </View>
      )}
      {sync !== null && sync.verdict.state === 'NOT_YET_OBSERVED' && (
        <View style={[t.notice, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line }]}>
          <Text style={t.noticeTitle}>Nothing to report yet</Text>
          <Text style={t.noticeBody}>
            This build started keeping records after the last reminder was due, so
            there is nothing to judge. The first real verdict is tomorrow morning.
          </Text>
        </View>
      )}

      <Text style={t.h2}>Acceptance tools</Text>
      <Pressable
        style={[t.buttonGhost, forceFallback && { borderColor: colors.accent }]}
        onPress={() => setForceFallback((v) => !v)}
      >
        <Text style={t.buttonGhostText}>
          {forceFallback ? '✓ ' : ''}Force D-017 fallback (writes SQLite)
        </Text>
      </Pressable>
      <Pressable style={t.buttonGhost} onPress={testRetention}>
        <Text style={t.buttonGhostText}>Test 45-day retention</Text>
      </Pressable>
      <Pressable style={t.buttonGhost} onPress={refreshSyncStatus}>
        <Text style={t.buttonGhostText}>Refresh morning-sync status</Text>
      </Pressable>

      {log.length > 0 && (
        <View style={[t.notice, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line }]}>
          {log.map((line) => (
            <Text key={line} style={t.mono}>
              {line}
            </Text>
          ))}
        </View>
      )}

      {probe.error !== null && (
        <View style={t.notice}>
          <Text style={t.noticeTitle}>Error</Text>
          <Text style={t.mono}>{probe.error}</Text>
        </View>
      )}

      <Pressable style={[t.button, busy && { opacity: 0.6 }]} onPress={rerun} disabled={busy}>
        <Text style={t.buttonText}>{busy ? 'Reading…' : 'Read again'}</Text>
      </Pressable>
      <Pressable style={t.buttonGhost} onPress={onClose}>
        <Text style={t.buttonGhostText}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

/** Local date and time for a stored instant, or an em dash when there is none. */
function stamp(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** Local `HH:MM → HH:MM` for a set of instants. Stays on the device (D-010). */
function spanOf(instants: number[], tzOffsetMin: number): string | null {
  if (instants.length === 0) return null;
  const at = (ms: number) => {
    const m = localMinuteOfDay(ms, tzOffsetMin);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const lo = Math.min(...instants);
  const hi = Math.max(...instants);
  const days = Math.round((hi - lo) / 86_400_000);
  return `${at(lo)} → ${at(hi)}${days > 0 ? ` (+${days}d)` : ''}`;
}

function fmt(v: boolean | number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={t.row}>
      <Text style={t.rowLabel}>{label}</Text>
      <Text style={t.rowValue}>{value}</Text>
    </View>
  );
}
