/**
 * AC-9 and AC-3.4 — nothing raw leaves, and nothing leaves to the wrong host.
 *
 * The guard has two independent rules and both are absolute (D-034): one allowed
 * origin, and no forbidden key / ISO instant / epoch-ms integer in any body, with
 * no exemptions. `computed_at` is the exemption that was specifically refused —
 * the server sets it instead — so it is tested as forbidden here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveDailyState } from '../app/src/derive';
import { SERVER_ROW_COLUMNS, toServerRow } from '../app/src/net/payload';
import {
  __resetAllowedOriginForTests,
  assertAllowedHost,
  assertNoRawHealth,
  ForbiddenHostError,
  guardedFetch,
  RawHealthLeakError,
  setAllowedOrigin,
} from '../app/src/net/guard';
import { deriveCases } from './helpers/fixtures';

const COMPUTED_AT = Date.parse('2026-09-07T04:00:00Z');
const PROJECT = 'https://abcdefghijklmnopqrst.supabase.co';

describe('AC-3.4 — host restriction', () => {
  beforeEach(() => {
    __resetAllowedOriginForTests();
  });

  it('refuses every host until an origin is registered', () => {
    expect(() => assertAllowedHost(`${PROJECT}/rest/v1/daily_states`)).toThrow(
      ForbiddenHostError,
    );
  });

  it('allows the registered origin', () => {
    setAllowedOrigin(PROJECT);
    expect(() => assertAllowedHost(`${PROJECT}/rest/v1/daily_states`)).not.toThrow();
  });

  it('refuses any other host, including look-alikes', () => {
    setAllowedOrigin(PROJECT);
    for (const bad of [
      'https://evil.example/collect',
      'http://abcdefghijklmnopqrst.supabase.co/rest/v1', // wrong scheme
      'https://abcdefghijklmnopqrst.supabase.co.evil.example/x',
      'https://other.supabase.co/rest/v1',
    ]) {
      expect(() => assertAllowedHost(bad), bad).toThrow(ForbiddenHostError);
    }
  });

  it('refuses a malformed URL rather than letting it through', () => {
    setAllowedOrigin(PROJECT);
    expect(() => assertAllowedHost('not a url')).toThrow(ForbiddenHostError);
  });
});

describe('AC-9 / AC-3.4 — body restriction', () => {
  it('refuses a sleep timestamp under any spelling', () => {
    for (const body of [
      { sleep_start: '2026-09-06T17:40:00Z' },
      { startMs: 1757180400000 },
      { nested: { deep: [{ endDate: '2026-09-07T01:05:00Z' }] } },
    ]) {
      expect(() => assertNoRawHealth(body), JSON.stringify(body)).toThrow(
        RawHealthLeakError,
      );
    }
  });

  it('refuses heart-rate and resting heart-rate values', () => {
    expect(() => assertNoRawHealth({ hr: [{ bpm: 58 }] })).toThrow(RawHealthLeakError);
    expect(() => assertNoRawHealth({ resting_bpm: 54 })).toThrow(RawHealthLeakError);
  });

  it('refuses computed_at — the exemption D-034 deliberately did not grant', () => {
    expect(() => assertNoRawHealth({ computed_at: 1757180400000 })).toThrow(
      RawHealthLeakError,
    );
    expect(() => assertNoRawHealth({ computedAt: '2026-09-07T04:00:00Z' })).toThrow(
      RawHealthLeakError,
    );
  });

  it('refuses a bare epoch-ms integer wherever it appears', () => {
    expect(() => assertNoRawHealth({ anything: 1757180400000 })).toThrow(
      RawHealthLeakError,
    );
  });

  it('allows device_clock_offset_min, which is a count of minutes, not a time', () => {
    expect(() => assertNoRawHealth({ device_clock_offset_min: -3 })).not.toThrow();
    expect(() => assertNoRawHealth({ device_clock_offset_min: 0 })).not.toThrow();
  });

  it('allows a well-formed server row', () => {
    expect(() =>
      assertNoRawHealth({
        commitment_id: 1,
        night_date: '2026-09-07',
        state: 'KEPT',
        integrity: 'OK',
        source_id: 'com.garmin.android.apps.connectmobile',
        wear_presence: true,
        deviation_min: 10,
        frozen: false,
        device_clock_offset_min: 2,
      }),
    ).not.toThrow();
  });
});

describe('the payload whitelist', () => {
  it('emits exactly the columns spec §7 allows, and no computed_at', () => {
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
    const row = toServerRow(result.night, 1, -2);

    expect(Object.keys(row).sort()).toEqual([...SERVER_ROW_COLUMNS].sort());
    expect(Object.keys(row)).not.toContain('computed_at');
  });
});

describe('guardedFetch end to end', () => {
  let sent: { url: string; body: string | undefined }[];

  beforeEach(() => {
    __resetAllowedOriginForTests();
    setAllowedOrigin(PROJECT);
    sent = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        sent.push({ url: String(input), body: init?.body as string | undefined });
        return new Response('{}', { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends every fixture night without leaking a timestamp or a bpm value', async () => {
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

      await guardedFetch(`${PROJECT}/rest/v1/daily_states`, {
        method: 'POST',
        body: JSON.stringify(toServerRow(result.night, 1, 0)),
      });

      const body = sent[sent.length - 1].body ?? '';
      for (const s of c.sessions) {
        expect(body).not.toContain(String(s.startMs));
        expect(body).not.toContain(new Date(s.startMs).toISOString());
        expect(body).not.toContain(String(s.endMs));
      }
      for (const h of c.hr.slice(0, 20)) {
        expect(body).not.toContain(String(h.atMs));
      }
      expect(body).not.toMatch(/"bpm"|"heartRate"|"samples"|"computed_at"/);
    }
  });

  it('refuses to send a poisoned body, and nothing reaches fetch', async () => {
    await expect(
      guardedFetch(`${PROJECT}/rest/v1/daily_states`, {
        method: 'POST',
        body: JSON.stringify({ night_date: '2026-09-07', startMs: 1757180400000 }),
      }),
    ).rejects.toBeInstanceOf(RawHealthLeakError);
    expect(sent).toHaveLength(0);
  });

  it('refuses a request to another host, and nothing reaches fetch', async () => {
    await expect(
      guardedFetch('https://evil.example/collect', {
        method: 'POST',
        body: JSON.stringify({ state: 'KEPT' }),
      }),
    ).rejects.toBeInstanceOf(ForbiddenHostError);
    expect(sent).toHaveLength(0);
  });

  it('scans a non-JSON body rather than waving it through', async () => {
    await expect(
      guardedFetch(`${PROJECT}/rest/v1/x`, {
        method: 'POST',
        body: 'plain text with 2026-09-06T17:40:00Z inside',
      }),
    ).rejects.toBeInstanceOf(RawHealthLeakError);
  });
});
