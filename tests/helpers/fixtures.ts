/**
 * Fixture loader: expands the compact generators in derivation-cases.json into
 * the concrete inputs `deriveDailyState` expects.
 *
 * The generators exist so a case can state a wear-presence ratio exactly (7 of
 * 10 buckets) instead of hiding it in a wall of hand-written samples.
 */
import cases from '../fixtures/derivation-cases.json';
import type {
  Commitment,
  DerivedNight,
  HrSample,
  RecordingMethod,
  RhrNight,
  SleepSession,
} from '../../app/src/derive/types';

const MIN_MS = 60_000;
const BUCKET_MS = 30 * MIN_MS;

/** Plausible sleeping heart rate; the value is irrelevant to every assertion. */
const FILLER_BPM = 58;

export interface ExpectedDerive {
  state: string;
  integrity: string;
  wearPresence: boolean;
  deviationMin: number | null;
  sourceId: string | null;
}

export interface ExpectedRevision {
  state: string;
  integrity: string;
  frozen: boolean;
  revisionCount: number;
}

export interface DeriveCase {
  id: string;
  ac: string;
  kind: 'derive';
  description: string;
  platform: 'android' | 'ios';
  nightDate: string;
  tzOffsetMin: number;
  prevTzOffsetMin?: number;
  commitment: Commitment;
  sessions: SleepSession[];
  hr: HrSample[];
  rhrHistory?: RhrNight[];
  expected: ExpectedDerive;
}

export interface RevisionCase {
  id: string;
  ac: string;
  kind: 'revision';
  description: string;
  tzOffsetMin: number;
  nowMs: number;
  existing: DerivedNight;
  fresh: DerivedNight;
  expected: ExpectedRevision;
}

type RawCase = (typeof cases)['cases'][number];

function expandHr(spec: Record<string, unknown>): HrSample[] {
  const mode = spec.mode as string;
  if (mode === 'none') return [];

  const sourceId = spec.sourceId as string;
  const startMs = Date.parse(spec.startIso as string);

  if (mode === 'cover') {
    const endMs = Date.parse(spec.endIso as string);
    const stepMs = (spec.everyMin as number) * MIN_MS;
    const out: HrSample[] = [];
    for (let t = startMs; t < endMs; t += stepMs) {
      out.push({ sourceId, atMs: t, bpm: FILLER_BPM });
    }
    return out;
  }

  if (mode === 'buckets') {
    // One sample mid-bucket for the first N buckets, leaving the rest uncovered.
    const count = spec.bucketCount as number;
    const out: HrSample[] = [];
    for (let i = 0; i < count; i += 1) {
      out.push({ sourceId, atMs: startMs + i * BUCKET_MS + BUCKET_MS / 2, bpm: FILLER_BPM });
    }
    return out;
  }

  throw new Error(`Unknown hr fixture mode: ${mode}`);
}

function expandRhr(spec: Record<string, unknown> | undefined): RhrNight[] | undefined {
  if (!spec) return undefined;
  if (spec.mode !== 'generate') throw new Error(`Unknown rhr mode: ${String(spec.mode)}`);

  const nights = spec.nights as number;
  const recentNights = spec.recentNights as number;
  const baselineBpm = spec.baselineBpm as number;
  const recentBpm = spec.recentBpm as number;
  const endBefore = Date.parse(`${spec.endBefore as string}T00:00:00Z`);

  const out: RhrNight[] = [];
  for (let i = nights; i >= 1; i -= 1) {
    const day = new Date(endBefore - i * 24 * 60 * MIN_MS);
    out.push({
      nightDate: day.toISOString().slice(0, 10),
      restingBpm: i <= recentNights ? recentBpm : baselineBpm,
    });
  }
  return out;
}

function toSessions(raw: readonly Record<string, unknown>[]): SleepSession[] {
  return raw.map((s) => ({
    sourceId: s.sourceId as string,
    startMs: Date.parse(s.startIso as string),
    endMs: Date.parse(s.endIso as string),
    recordingMethod: s.recordingMethod as RecordingMethod,
  }));
}

function loadAll(): (DeriveCase | RevisionCase)[] {
  return (cases.cases as unknown as RawCase[]).map((c) => {
    const raw = c as unknown as Record<string, unknown>;

    if (raw.kind === 'revision') {
      return {
        id: raw.id as string,
        ac: raw.ac as string,
        kind: 'revision',
        description: raw.description as string,
        tzOffsetMin: raw.tzOffsetMin as number,
        nowMs: Date.parse(raw.nowIso as string),
        existing: raw.existing as unknown as DerivedNight,
        fresh: raw.fresh as unknown as DerivedNight,
        expected: raw.expected as unknown as ExpectedRevision,
      } satisfies RevisionCase;
    }

    const input = raw.input as Record<string, unknown>;
    return {
      id: raw.id as string,
      ac: raw.ac as string,
      kind: 'derive',
      description: raw.description as string,
      platform: raw.platform as 'android' | 'ios',
      nightDate: input.nightDate as string,
      tzOffsetMin: input.tzOffsetMin as number,
      prevTzOffsetMin: input.prevTzOffsetMin as number | undefined,
      commitment: input.commitment as unknown as Commitment,
      sessions: toSessions(input.sessions as Record<string, unknown>[]),
      hr: expandHr(input.hr as Record<string, unknown>),
      rhrHistory: expandRhr(input.rhrHistory as Record<string, unknown> | undefined),
      expected: raw.expected as unknown as ExpectedDerive,
    } satisfies DeriveCase;
  });
}

export const allCases = loadAll();

export const deriveCases = allCases.filter((c): c is DeriveCase => c.kind === 'derive');

export const revisionCases = allCases.filter(
  (c): c is RevisionCase => c.kind === 'revision',
);
