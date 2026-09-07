/**
 * AC-9 / D-010: no raw sleep timestamp or heart-rate value may appear in any
 * network request.
 *
 * The test drives the real pipeline — fixture sessions and HR through
 * `deriveDailyState`, through `toServerRow`, out through `guardedFetch` — with
 * `fetch` stubbed, then inspects what the stub actually received. It also tries
 * to smuggle raw values past the guard on purpose, so a guard that silently
 * stopped working would fail the suite rather than pass it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveDailyState } from '../app/src/derive';
import { toServerRow } from '../app/src/net/payload';
import { assertNoRawHealth, guardedFetch, RawHealthLeakError } from '../app/src/net/guard';
import { deriveCases } from './helpers/fixtures';

const COMPUTED_AT = Date.parse('2026-09-07T04:00:00Z');

/** Everything the fixtures contain that must never cross the wire. */
function rawValuesIn(caseData: (typeof deriveCases)[number]): string[] {
  const forbidden: string[] = [];
  for (const s of caseData.sessions) {
    forbidden.push(String(s.startMs), String(s.endMs));
    forbidden.push(new Date(s.startMs).toISOString(), new Date(s.endMs).toISOString());
  }
  for (const h of caseData.hr) {
    forbidden.push(String(h.atMs), new Date(h.atMs).toISOString());
  }
  return forbidden;
}

describe('AC-9 — network guard', () => {
  let sent: string[];
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sent = [];
    fetchStub = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.body !== undefined) sent.push(String(init.body));
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads every fixture night without leaking a timestamp or a bpm value', async () => {
    for (const c of deriveCases) {
      const result = deriveDailyState(
        {
          nightDate: c.nightDate,
          commitment: c.commitment,
          sessions: c.sessions,
          hr: c.hr,
          tzOffsetMin: c.tzOffsetMin,
          prevTzOffsetMin: c.prevTzOffsetMin,
          rhrHistory: c.rhrHistory,
        },
        c.platform,
        COMPUTED_AT,
      );

      await guardedFetch('https://example.invalid/daily_states', {
        method: 'POST',
        body: toServerRow(result.night),
      });

      const body = sent[sent.length - 1];
      for (const raw of rawValuesIn(c)) {
        expect(body, `${c.id} leaked ${raw}`).not.toContain(raw);
      }
      // Sleeping heart rates are two-digit; assert no bare bpm-looking key exists.
      expect(body).not.toMatch(/"bpm"|"heartRate"|"samples"/);
    }

    expect(fetchStub).toHaveBeenCalledTimes(deriveCases.length);
  });

  it('the payload carries only the columns spec §7 allows', () => {
    const c = deriveCases[0];
    const result = deriveDailyState(
      {
        nightDate: c.nightDate,
        commitment: c.commitment,
        sessions: c.sessions,
        hr: c.hr,
        tzOffsetMin: c.tzOffsetMin,
      },
      c.platform,
      COMPUTED_AT,
    );
    expect(Object.keys(toServerRow(result.night)).sort()).toEqual([
      'deviation_min',
      'frozen',
      'integrity',
      'night_date',
      'source_id',
      'state',
      'wear_presence',
    ]);
  });

  it('refuses a body containing a sleep timestamp', async () => {
    await expect(
      guardedFetch('https://example.invalid/x', {
        body: { night_date: '2026-09-07', startMs: 1757180400000 },
      }),
    ).rejects.toBeInstanceOf(RawHealthLeakError);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('refuses a body containing an ISO instant, however deeply nested', () => {
    expect(() =>
      assertNoRawHealth({ a: { b: [{ c: '2026-09-06T17:40:00Z' }] } }),
    ).toThrow(RawHealthLeakError);
  });

  it('refuses a body containing heart-rate samples', () => {
    expect(() => assertNoRawHealth({ hr: [{ bpm: 58 }] })).toThrow(RawHealthLeakError);
    expect(() => assertNoRawHealth({ payload: { samples: [] } })).toThrow(RawHealthLeakError);
  });

  it('refuses the commitment times, which are also private to the device', () => {
    expect(() => assertNoRawHealth({ bedTargetMin: 1380 })).toThrow(RawHealthLeakError);
  });

  it('allows a well-formed server row', () => {
    expect(() =>
      assertNoRawHealth({
        night_date: '2026-09-07',
        state: 'KEPT',
        integrity: 'OK',
        source_id: 'com.garmin.android.apps.connectmobile',
        wear_presence: true,
        deviation_min: 10,
        frozen: false,
      }),
    ).not.toThrow();
  });
});
