/**
 * Network confinement (was AC-2.6's "no network at all"; now AC-3.4/AC-3.5).
 *
 * T-003 deliberately gives the app a backend, so the T-002 invariant — nothing in
 * the app reaches the upload boundary — is now false by design. It has been
 * replaced rather than deleted, because the property that actually matters is
 * unchanged: **the only way data leaves is through the guard, to one host, via the
 * §7 whitelist.**
 *
 * This is the static half. The runtime half is `netguard.test.ts`; the device half
 * is AC-3.5, in R-003 §9.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_ROOT = new URL('../app/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Modules allowed to touch the network or construct the client. */
const NETWORK_LAYER = ['src/net/guard.ts', 'src/backend/client.ts'];

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.expo', 'android', 'ios', 'scripts'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

/** Comments describe the rules; they are not violations of them. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Windows separators would otherwise defeat every path comparison below. */
const rel = (p: string) => p.slice(APP_ROOT.length).split('\\').join('/');

const appSources = () =>
  sourceFiles(APP_ROOT).map((path) => ({
    path,
    rel: rel(path),
    text: stripComments(readFileSync(path, 'utf8')),
  }));

const outsideNetworkLayer = () =>
  appSources().filter((f) => !NETWORK_LAYER.includes(f.rel));

describe('network confinement', () => {
  it('finds source files to check (guards against a silently empty scan)', () => {
    expect(appSources().length).toBeGreaterThan(15);
    expect(appSources().some((f) => f.path.endsWith('App.tsx'))).toBe(true);
  });

  it('calls no raw network API outside the network layer', () => {
    const offenders: string[] = [];
    const banned = [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bsendBeacon\b/];
    for (const { path, text } of outsideNetworkLayer()) {
      for (const re of banned) if (re.test(text)) offenders.push(`${path} :: ${String(re)}`);
    }
    expect(offenders).toEqual([]);
  });

  it('creates the Supabase client in exactly one place', () => {
    const creators = appSources().filter((f) => /createClient\s*\(/.test(f.text));
    expect(creators.map((f) => f.rel)).toEqual(['src/backend/client.ts']);
  });

  it('hands the client the guarded fetch, not the global one', () => {
    const client = readFileSync(join(APP_ROOT, 'src', 'backend', 'client.ts'), 'utf8');
    expect(client).toMatch(/global:\s*\{\s*fetch:\s*guardedFetch\s*\}/);
    expect(client).toMatch(/setAllowedOrigin\(/);
  });

  it('builds server rows only through the whitelist', () => {
    // Anything writing to daily_states must go through toServerRow, never build a
    // row literal of its own.
    // Call sites and the definition only — a mention in prose is not a use.
    const users = appSources().filter((f) =>
      /toServerRow\s*\(|export function toServerRow/.test(f.text),
    );
    expect(users.map((f) => f.rel).sort()).toEqual([
      'src/backend/sync.ts',
      'src/net/payload.ts',
    ]);
  });

  it('imports no HTTP client other than the Supabase SDK', () => {
    const offenders: string[] = [];
    const banned = /from ['"](axios|node-fetch|superagent|got|firebase[^'"]*)['"]/;
    for (const { rel: r, text } of appSources()) if (banned.test(text)) offenders.push(r);
    expect(offenders).toEqual([]);
  });

  it('declares no backend dependency other than Supabase', () => {
    const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'));
    const banned = Object.keys(pkg.dependencies ?? {}).filter((n) =>
      /^(axios|node-fetch|firebase|@react-native-firebase\/|pocketbase|@aws-)/.test(n),
    );
    expect(banned).toEqual([]);
  });

  it('ships no secret key and no hard-coded project URL', () => {
    const offenders: string[] = [];
    for (const { path, text } of appSources()) {
      // An actual key value, not the prefix used by the guard that rejects one.
      if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) offenders.push(`${path} :: secret key`);
      if (/https:\/\/[a-z0-9]{20}\.supabase\.co/.test(text)) {
        offenders.push(`${path} :: hard-coded project URL`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
