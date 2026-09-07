/**
 * Layer 2 of the permission guard: generate the real AndroidManifest.xml and diff
 * it against what the app declares and requires.
 *
 * Kept out of `npm test` because it runs `expo prebuild`, which is slow and writes
 * to disk. Run it whenever app.json, a config plugin, or a native dependency
 * changes — and in CI before a build.
 *
 * Exits non-zero, loudly, on any divergence.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(APP_ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const HAD_ANDROID_DIR = existsSync(join(APP_ROOT, 'android'));

/** Mirrors src/platform/androidPermissions.ts. Kept in sync by the vitest suite. */
const REQUIRED = [
  'android.permission.health.READ_SLEEP',
  'android.permission.health.READ_HEART_RATE',
  'android.permission.health.READ_RESTING_HEART_RATE',
  'android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND',
  'android.permission.health.READ_HEALTH_DATA_HISTORY',
  'android.permission.POST_NOTIFICATIONS',
];

const FORBIDDEN = [/^android\.permission\.health\.WRITE_/];

const fail = (lines) => {
  console.error('\n✖ Manifest permission check FAILED\n');
  for (const l of lines) console.error(`  ${l}`);
  console.error('');
  process.exit(1);
};

console.log('Generating AndroidManifest.xml via expo prebuild…');
// `shell: true` because on Windows npx is a .cmd shim that execFile cannot spawn
// directly. Arguments here are all literals, so there is nothing to inject.
execFileSync(
  'npx',
  ['expo', 'prebuild', '--platform', 'android', '--no-install', '--clean'],
  { cwd: APP_ROOT, stdio: 'inherit', shell: true },
);

if (!existsSync(MANIFEST)) fail([`No manifest generated at ${MANIFEST}`]);

const xml = readFileSync(MANIFEST, 'utf8');
const inManifest = [...xml.matchAll(/android:name="(android\.permission\.[^"]+)"/g)].map(
  (m) => m[1],
);

const declared = JSON.parse(readFileSync(join(APP_ROOT, 'app.json'), 'utf8')).expo.android
  .permissions;

const problems = [];
for (const p of new Set([...REQUIRED, ...declared])) {
  if (!inManifest.includes(p)) problems.push(`MISSING from manifest: ${p}`);
}
for (const p of inManifest) {
  if (FORBIDDEN.some((re) => re.test(p))) problems.push(`FORBIDDEN in manifest: ${p}`);
}

// Leave the tree as it was found: prebuild output is generated, not source.
if (!HAD_ANDROID_DIR) rmSync(join(APP_ROOT, 'android'), { recursive: true, force: true });

if (problems.length > 0) fail(problems);

console.log('\n✓ Manifest permission check passed');
console.log(`  ${inManifest.length} permissions in manifest, ${REQUIRED.length} required:`);
for (const p of REQUIRED) console.log(`    ✓ ${p}`);
