/**
 * AC-2.6 — T-002 makes no network request at all.
 *
 * A runtime intercept on the device is the real evidence (R-002 §3 describes it).
 * This is the static half: no module reachable from the app performs a network
 * call, and no upload path exists to be called by accident.
 *
 * D-010 is a property of the build here, not a check at the boundary: the guard
 * in src/net exists and is tested, but nothing in T-002 ever reaches it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_ROOT = new URL('../app/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.expo' || entry === 'android' || entry === 'ios') {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Everything the app ships, minus the deliberately-unused net guard. */
function appSources(): { path: string; text: string }[] {
  return sourceFiles(APP_ROOT)
    .filter((p) => !p.includes(`${join('src', 'net')}`))
    .map((path) => ({ path, text: readFileSync(path, 'utf8') }));
}

describe('AC-2.6 — no network in the shipped app', () => {
  it('finds source files to check (guards against a silently empty scan)', () => {
    const files = appSources();
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.path.endsWith('App.tsx'))).toBe(true);
  });

  it('calls no network API anywhere outside src/net', () => {
    const offenders: string[] = [];
    // Word-boundary matches so `refetch`, `websocketish` names etc. do not trip it.
    const banned = [
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /\bWebSocket\b/,
      /\bnavigator\.sendBeacon\b/,
      /\baxios\b/,
      /\bEventSource\b/,
    ];
    for (const { path, text } of appSources()) {
      for (const re of banned) {
        if (re.test(text)) offenders.push(`${path} :: ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('imports no HTTP or backend client', () => {
    const offenders: string[] = [];
    const banned = /from ['"](axios|node-fetch|@supabase\/[^'"]+|firebase[^'"]*)['"]/;
    for (const { path, text } of appSources()) {
      if (banned.test(text)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it('declares no backend dependency in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'));
    const names = Object.keys(pkg.dependencies ?? {});
    const banned = names.filter((n) =>
      /^(axios|node-fetch|@supabase\/|firebase|@react-native-firebase\/|pocketbase|@aws-)/.test(n),
    );
    expect(banned).toEqual([]);
  });

  it('the upload boundary exists but nothing in the app reaches it', () => {
    const importers = appSources().filter((f) => /from ['"].*net\/(guard|payload)['"]/.test(f.text));
    expect(importers.map((f) => f.path)).toEqual([]);
  });
});
