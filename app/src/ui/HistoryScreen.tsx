/**
 * Spec §11 screen 6 — Home, in its local T-002 form.
 *
 * Last 30 nights, the streak, the lifetime kept-count. No score, no chart, no
 * physiology, no comparison — D-005 and D-007 rule all of those out, and there is
 * nobody to compare to yet anyway.
 *
 * Copy rule (spec §11): no health claim.
 */
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Commitment, DerivedNight } from '../derive/types';
import { colors, hhmm, prettyDate, stateColor, t } from './theme';

const STATE_LABEL: Record<string, string> = {
  KEPT: 'Kept',
  MISSED: 'Missed',
  NO_DATA: 'No data',
  TRAVEL: 'Travel',
};

interface Props {
  readonly commitment: Commitment;
  readonly nights: readonly DerivedNight[];
  readonly streak: number;
  readonly lifetimeKept: number;
  readonly promptDeviceCheck: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onRefresh: () => void;
  readonly onEditCommitment: () => void;
  /** Long-press the title to reach the T-001 harness (D-022). */
  readonly onOpenHarness: () => void;
  readonly onOpenSettings: () => void;
}

export function HistoryScreen(p: Props) {
  const recent = [...p.nights].reverse().slice(0, 30);
  const last = recent[0];

  return (
    <ScrollView style={t.screen} contentContainerStyle={t.content}>
      <Pressable onLongPress={p.onOpenHarness} delayLongPress={800}>
        <Text style={t.h1}>Zenoho</Text>
      </Pressable>
      <Text style={t.sub}>
        Asleep by {hhmm(p.commitment.bedTargetMin)}, awake by{' '}
        {hhmm(p.commitment.wakeTargetMin)}, within {p.commitment.toleranceMin} minutes.
      </Text>

      {p.error !== null && (
        <View style={t.notice}>
          <Text style={t.noticeTitle}>{`Couldn't read your watch`}</Text>
          <Text style={t.noticeBody}>{p.error}</Text>
          <Text style={t.noticeBody}>
            Nothing was recorded for this attempt — a failed read is not a missed night.
          </Text>
        </View>
      )}

      {p.promptDeviceCheck && (
        <View style={t.notice}>
          <Text style={t.noticeTitle}>Three nights with no data</Text>
          <Text style={t.noticeBody}>
            Check that your watch is syncing to Health Connect, and that it was worn
            overnight.
          </Text>
        </View>
      )}

      <Text style={t.h2}>Last night</Text>
      {last ? (
        <View style={t.card}>
          <Text style={{ fontSize: 32, fontWeight: '600', color: stateColor(last.state) }}>
            {STATE_LABEL[last.state] ?? last.state}
          </Text>
          <Text style={t.sub}>
            {prettyDate(last.nightDate)}
            {last.deviationMin !== null && last.state === 'MISSED'
              ? ` · out by ${last.deviationMin} min`
              : ''}
            {last.integrity === 'UNVERIFIED' ? ' · unverified' : ''}
            {!last.frozen ? ' · may still change today' : ''}
          </Text>
        </View>
      ) : (
        <View style={[t.card, t.empty]}>
          <Text style={t.body}>Nothing yet.</Text>
          <Text style={t.sub}>
            Wear your watch overnight and open Zenoho in the morning.
          </Text>
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
        <Stat label="Streak" value={String(p.streak)} hint="nights kept in a row" />
        <Stat label="Kept" value={String(p.lifetimeKept)} hint="nights all-time" />
      </View>

      <Text style={t.h2}>Last 30 nights</Text>
      {recent.length === 0 ? (
        <View style={[t.card, t.empty]}>
          <Text style={t.body}>No nights recorded yet.</Text>
        </View>
      ) : (
        <View style={t.card}>
          {recent.map((n) => (
            <View key={n.nightDate} style={t.row}>
              <Text style={t.rowLabel}>{prettyDate(n.nightDate)}</Text>
              <Text style={[t.rowValue, { color: stateColor(n.state) }]}>
                {STATE_LABEL[n.state] ?? n.state}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Pressable style={[t.button, p.busy && { opacity: 0.6 }]} disabled={p.busy} onPress={p.onRefresh}>
        <Text style={t.buttonText}>{p.busy ? 'Reading…' : 'Check last night'}</Text>
      </Pressable>

      <Pressable style={t.buttonGhost} onPress={p.onEditCommitment} disabled={p.busy}>
        <Text style={t.buttonGhostText}>Change my promise</Text>
      </Pressable>

      <Pressable style={t.buttonGhost} onPress={p.onOpenSettings} disabled={p.busy}>
        <Text style={t.buttonGhostText}>Settings</Text>
      </Pressable>

      <Text style={t.footnote}>
        Your sleep times and heart rate stay on this phone. When you are signed in,
        only the result of each night — kept, missed or no data — is sent to your
        account. Settings explains exactly what does and does not leave.
      </Text>
      <Text style={t.footnote}>
        The morning reminder can arrive late, or not at all, depending on how your
        phone manages battery. It does not matter: opening Zenoho any time in the day
        works out the night just the same.
      </Text>
    </ScrollView>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <View style={[t.card, { flex: 1 }]}>
      <Text style={{ fontSize: 28, fontWeight: '600', color: colors.ink }}>{value}</Text>
      <Text style={{ fontSize: 14, color: colors.inkSoft, marginTop: 2 }}>{label}</Text>
      <Text style={{ fontSize: 12, color: colors.inkMuted, marginTop: 2 }}>{hint}</Text>
    </View>
  );
}
