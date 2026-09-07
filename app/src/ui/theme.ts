/**
 * Shared visual tokens. Deliberately small — T-002's UI has to be legible and
 * honest about empty and error states, not designed.
 */
import { Platform, StyleSheet } from 'react-native';

export const colors = {
  bg: '#faf9f7',
  card: '#ffffff',
  ink: '#1a1a1a',
  inkSoft: '#3a3a3a',
  inkMuted: '#6b6b6b',
  line: '#e2e0dc',
  kept: '#2f6f4f',
  missed: '#9a4b32',
  quiet: '#8a8681',
  noticeBg: '#fff4e5',
  accent: '#1a1a1a',
} as const;

export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

export const t = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 56, paddingBottom: 48 },
  h1: { fontSize: 24, fontWeight: '600', color: colors.ink },
  h2: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 28,
    marginBottom: 8,
  },
  sub: { fontSize: 14, color: colors.inkMuted, marginTop: 4, lineHeight: 20 },
  body: { fontSize: 15, color: colors.inkSoft, lineHeight: 22 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    gap: 12,
  },
  rowLabel: { fontSize: 15, color: colors.inkSoft, flexShrink: 1 },
  rowValue: { fontSize: 15, color: colors.ink, fontWeight: '500' },
  button: {
    marginTop: 24,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  buttonGhost: {
    marginTop: 12,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  buttonGhostText: { color: colors.inkSoft, fontSize: 15, fontWeight: '500' },
  notice: {
    backgroundColor: colors.noticeBg,
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
    gap: 6,
  },
  noticeTitle: { fontSize: 15, fontWeight: '600', color: colors.ink },
  noticeBody: { fontSize: 14, color: colors.inkSoft, lineHeight: 20 },
  mono: { fontFamily: mono, fontSize: 12, color: colors.ink, paddingVertical: 2 },
  footnote: { fontSize: 12, color: colors.inkMuted, marginTop: 24, lineHeight: 18 },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 8 },
});

export function stateColor(state: string): string {
  if (state === 'KEPT') return colors.kept;
  if (state === 'MISSED') return colors.missed;
  return colors.quiet;
}

/** `2026-09-07` → `Mon 7 Sep`. Local formatting only; nothing leaves the device. */
export function prettyDate(nightDate: string): string {
  const [y, m, d] = nightDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${days[dt.getUTCDay()]} ${dt.getUTCDate()} ${months[dt.getUTCMonth()]}`;
}

/** Minute-of-day → `HH:MM`. */
export function hhmm(minuteOfDay: number): string {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
