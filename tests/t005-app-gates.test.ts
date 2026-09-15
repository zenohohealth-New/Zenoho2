/**
 * T-005 structural gates: three behaviours that only exist in the app shell, and
 * so cannot be reached from a pure-Node test — the boot effect, the tap
 * handler's early return, and what the status line prints.
 *
 * Source-level assertions, like the T-003-R ones. They are weaker than running
 * the app, and they are the strongest thing available on a machine with no
 * emulator. Each fails against the code as it stood before this task, which is
 * the only reason to trust it. AC-5.5, AC-5.6 and AC-5.7 still need the device.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const winPath = (u: URL) => u.pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (rel: string) => readFileSync(winPath(new URL(rel, import.meta.url)), 'utf8');

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const APP = stripComments(read('../app/App.tsx'));
const HISTORY = stripComments(read('../app/src/ui/HistoryScreen.tsx'));

describe('F3 — an expired token offline must not read as signed out', () => {
  it('boot inspects the error from getSession, not only the data', () => {
    // supabase-js does not throw when it cannot refresh: offline with an expired
    // access token it returns { session: null, error: AuthRetryableFetchError }.
    // Reading only `data` makes that indistinguishable from a real sign-out.
    expect(APP).toMatch(/const \{ data, error \} = await getSupabase\(\)\.auth\.getSession\(\)/);
    expect(APP).toMatch(/sessionKnown = error === null/);
    expect(APP).not.toMatch(/sessionKnown = true/);
  });

  it('sign-in is forced only when the absence of a session is confirmed', () => {
    expect(APP).toMatch(/sessionKnown && session === null/);
  });
});

describe('AC-5.5 — a revoked Health Connect permission is never silent', () => {
  it('the permission branch sets an explicit note before returning', () => {
    const handler = /const sync = useCallback\([\s\S]*?\n  \);/.exec(APP)?.[0] ?? '';
    expect(handler).toMatch(/requestReadPermissions\(\)\) !== 'GRANTED'/);
    // The note must be assigned in the same branch, ahead of the `return`, or
    // the finally writes the default "Finished." over a failure.
    const branch = /!== 'GRANTED'\) \{[\s\S]*?return;/.exec(handler)?.[0] ?? '';
    expect(branch).toMatch(/note = /);
    expect(branch).toMatch(/permission/i);
    expect(branch).not.toMatch(/NO_DATA/);
  });

  it('every exit from the handler leaves a note, including the thrown case', () => {
    expect(APP).toMatch(/finally \{\s*setCheckNote\(note\);/);
    expect(APP).toMatch(/catch \(e\)[\s\S]{0,220}note = /);
  });
});

describe('DEF-005-05 — skipped nights are derived, not left absent', () => {
  it('the tap handler catches up the whole window, not just last night', () => {
    expect(APP).toMatch(/catchUpMissingNights\(base\)/);
    // The old first-run-only backfill must be gone: it was the branch that made
    // "derive everything" conditional on the store being empty.
    expect(APP).not.toMatch(/countNights\(c\.id\)\) === 0/);
    expect(APP).not.toMatch(/await backfill\(/);
  });

  it('recovered nights are queued for upload, not only last night', () => {
    // Otherwise the server keeps exactly the hole the local history just lost.
    expect(APP).toMatch(/for \(const d of recovered\) await queueNight\(d\.stored\)/);
  });

  it('a warm resume derives, not just drains the queue', () => {
    // Tapping the morning reminder on an app still in memory reaches the
    // AppState listener, not the boot effect.
    const listener = /AppState\.addEventListener\('change'[\s\S]*?\}\);/.exec(APP)?.[0] ?? '';
    expect(listener).toMatch(/sync\(commitment\)/);
  });
});

describe('D-048 — the minutes-off figure is disclosed, and disclosed fully', () => {
  const SETTINGS = read('../app/src/ui/SettingsScreen.tsx');
  const SIGNIN = read('../app/src/ui/SignInScreen.tsx');

  // Listing deviation_min among what is uploaded was accurate but incomplete: a
  // reader could reasonably assume a number sent to a shared server is a number
  // a pod can see. D-048 keeps the column, so the copy has to carry the weight.
  for (const [name, src] of [
    ['Settings', SETTINGS],
    ['Sign-in', SIGNIN],
  ] as const) {
    it(`${name} says the minutes figure is stored on the account`, () => {
      expect(src).toMatch(/stored on your account/);
    });

    it(`${name} says only the member can see it`, () => {
      expect(src).toMatch(/[Oo]nly you can see it/);
    });

    it(`${name} makes no health claim`, () => {
      for (const claim of ['improve', 'better sleep', 'healthier', 'cure', 'treat', 'diagnos']) {
        expect(src.toLowerCase()).not.toContain(claim);
      }
    });
  }

  it('Settings names the pod explicitly, since that is the assumption being corrected', () => {
    expect(SETTINGS).toMatch(/pod/i);
  });
});

describe('AC-5.7 — one vocabulary for a state, and a usable No-data hint', () => {
  it('the status line prints the label, never the raw enum', () => {
    expect(APP).toMatch(/STATE_LABEL\[outcome\.stored\.state\]/);
    expect(APP).not.toMatch(/Last night: \$\{outcome\.stored\.state\}/);
  });

  it('the hint is appended on a No-data night', () => {
    expect(APP).toMatch(/outcome\.stored\.state === 'NO_DATA'[\s\S]{0,60}NO_DATA_HINT/);
  });

  it('the Home verdict card shows the hint too, not just the status line', () => {
    // The status line only appears after a tap. A member opening the app to a
    // No-data night from the morning notification never taps anything.
    expect(HISTORY).toMatch(/last\.state === 'NO_DATA' &&[\s\S]{0,60}NO_DATA_HINT/);
  });

  it('the label map is exported so there is one definition of it', () => {
    expect(HISTORY).toMatch(/export const STATE_LABEL/);
    expect(APP).toMatch(/import \{ HistoryScreen, STATE_LABEL \}/);
  });
});
