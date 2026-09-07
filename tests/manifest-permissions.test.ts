/**
 * Guards the gap that produced three bugs in two tasks: the code needs an Android
 * permission, and the manifest does not have it.
 *
 * Layer 1 (always runs, fast): what the code requires must be declared in
 * app.json. This is the layer that would have caught both real failures —
 * `READ_RESTING_HEART_RATE` was requested as a record type in the bridge but
 * never declared, and `POST_NOTIFICATIONS` was needed by an imported module and
 * likewise never declared.
 *
 * Layer 2 (runs when a generated manifest is present): what app.json declares
 * must actually reach AndroidManifest.xml. Generate one with
 * `npm run check:manifest`, which prebuilds, diffs, and reports.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_ANDROID_PERMISSION_PATTERNS,
  HEALTH_RECORD_PERMISSIONS,
  MODULE_PERMISSIONS,
  REQUIRED_ANDROID_PERMISSIONS,
} from '../app/src/platform/androidPermissions';

const APP_ROOT = new URL('../app/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MANIFEST = join(APP_ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

function declaredInAppJson(): string[] {
  const cfg = JSON.parse(readFileSync(join(APP_ROOT, 'app.json'), 'utf8'));
  return cfg.expo?.android?.permissions ?? [];
}

function registeredPlugins(): string[] {
  const cfg = JSON.parse(readFileSync(join(APP_ROOT, 'app.json'), 'utf8'));
  return (cfg.expo?.plugins ?? []).map((p: string | [string, unknown]) =>
    typeof p === 'string' ? p : p[0],
  );
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.expo', 'android', 'ios'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

const allSource = (): string =>
  sourceFiles(APP_ROOT)
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');

/** Record types the Health Connect bridge actually asks permission for. */
function recordTypesRequestedInCode(): string[] {
  const bridge = readFileSync(
    join(APP_ROOT, 'src', 'health', 'healthConnect.android.ts'),
    'utf8',
  );
  return [...bridge.matchAll(/recordType:\s*'([A-Za-z]+)'/g)].map((m) => m[1]);
}

describe('Layer 1 — the code requires nothing the manifest config omits', () => {
  it('every permission the app requires is declared in app.json', () => {
    const declared = declaredInAppJson();
    const missing = REQUIRED_ANDROID_PERMISSIONS.filter((p) => !declared.includes(p));
    expect(
      missing,
      `app.json is missing ${missing.length} required permission(s). ` +
        'Add them to expo.android.permissions, then re-run npm run check:manifest.',
    ).toEqual([]);
  });

  it('every record type the bridge requests maps to a declared permission', () => {
    // The exact shape of the READ_RESTING_HEART_RATE bug: a record type added to
    // the bridge's permission list, with no matching manifest permission.
    const declared = declaredInAppJson();
    const unmapped: string[] = [];
    for (const recordType of recordTypesRequestedInCode()) {
      const permission = HEALTH_RECORD_PERMISSIONS[recordType];
      if (permission === undefined) {
        unmapped.push(`${recordType} (no mapping in androidPermissions.ts)`);
      } else if (!declared.includes(permission)) {
        unmapped.push(`${recordType} -> ${permission} (not in app.json)`);
      }
    }
    expect(unmapped).toEqual([]);
  });

  it('every module that needs a permission has its config plugin registered', () => {
    // Two separate checks, because measurement showed they are separate mechanisms.
    // The permission comes from expo.android.permissions in app.json — verified by
    // prebuilding with and without each. The config plugin contributes other native
    // setup (notification icon, colour, sounds), not the permission. Registering it
    // is hygiene; declaring the permission is what actually reaches the manifest.
    const src = allSource();
    const plugins = registeredPlugins();
    const declared = declaredInAppJson();
    const problems: string[] = [];

    for (const [moduleName, permissions] of Object.entries(MODULE_PERMISSIONS)) {
      const used = new RegExp(`from ['"]${moduleName}['"]`).test(src);
      if (!used) continue;
      if (!plugins.includes(moduleName)) {
        problems.push(`${moduleName} is imported but its config plugin is not registered`);
      }
      for (const p of permissions) {
        if (!declared.includes(p)) problems.push(`${moduleName} needs ${p}, not in app.json`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('declares no health write permission (D-010: Zenoho never writes)', () => {
    const offenders = declaredInAppJson().filter((p) =>
      FORBIDDEN_ANDROID_PERMISSION_PATTERNS.some((re) => re.test(p)),
    );
    expect(offenders).toEqual([]);
  });

  it('the requirement list is non-empty, so a passing run means something', () => {
    expect(REQUIRED_ANDROID_PERMISSIONS.length).toBeGreaterThanOrEqual(6);
    expect(recordTypesRequestedInCode().length).toBeGreaterThanOrEqual(3);
  });
});

describe('Layer 2 — the generated manifest matches what was declared', () => {
  const present = existsSync(MANIFEST);

  it('reports whether a generated manifest was available to diff', () => {
    // Not an assertion about the manifest: a truthful record of what Layer 2 could
    // check on this run. `npm run check:manifest` generates one.
    expect(typeof present).toBe('boolean');
  });

  it.runIf(present)('contains every declared permission', () => {
    const xml = readFileSync(MANIFEST, 'utf8');
    const inManifest = new Set(
      [...xml.matchAll(/android:name="(android\.permission\.[^"]+)"/g)].map((m) => m[1]),
    );
    const missing = [...declaredInAppJson(), ...REQUIRED_ANDROID_PERMISSIONS].filter(
      (p) => !inManifest.has(p),
    );
    expect(missing).toEqual([]);
  });

  it.runIf(present)('contains no health write permission', () => {
    const xml = readFileSync(MANIFEST, 'utf8');
    const inManifest = [...xml.matchAll(/android:name="(android\.permission\.[^"]+)"/g)].map(
      (m) => m[1],
    );
    const offenders = inManifest.filter((p) =>
      FORBIDDEN_ANDROID_PERMISSION_PATTERNS.some((re) => re.test(p)),
    );
    expect(offenders).toEqual([]);
  });
});
