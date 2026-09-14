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

/**
 * Read straight out of src/platform/androidPermissions.ts, so the repo holds two
 * copies of this list — the TypeScript source of truth and app.json — instead of
 * three.
 *
 * The third copy used to live here, hand-maintained, under a comment claiming it
 * was "kept in sync by the vitest suite". That claim was false: the suite
 * imports the TypeScript and never opened this file. The drift was real, and it
 * surfaced as this script failing at run time — later and noisier than needed.
 *
 * Parsed rather than imported because this is a .mjs script and the source is
 * .ts, with no build step between them. Comments are stripped first: the source
 * names removed permissions in prose (READ_HEALTH_DATA_IN_BACKGROUND, and why it
 * went), and a regex that read comments would resurrect exactly what was deleted.
 */
function requiredPermissions() {
  const src = readFileSync(join(APP_ROOT, 'src', 'platform', 'androidPermissions.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const unique = [
    ...new Set([...src.matchAll(/'(android\.permission\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1])),
  ];
  if (unique.length === 0) {
    console.error('\n\u2716 could not parse any permission from androidPermissions.ts\n');
    process.exit(1);
  }
  return unique;
}

const REQUIRED = requiredPermissions();

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
