/**
 * Fail the build when the public backend config is absent (D-037).
 *
 * This exists because of a defect that shipped: preview APK f815ea27 was built in
 * the EAS cloud, which never receives the gitignored `app/.env`, so the app
 * installed cleanly and then reported "Backend is not configured" on the device.
 * Nothing local caught it — the values were present on the dev machine, and the
 * build succeeded.
 *
 * So the check has to run where the build runs. It is wired to the
 * `eas-build-post-install` hook, which EAS invokes after installing dependencies
 * and before bundling, with the profile's environment variables in scope.
 *
 * It also runs locally via `npm run check:env` after loading `app/.env`, so the
 * same rule applies in both places.
 *
 * These two values are public by design — the URL appears in every request and the
 * publishable key ships inside every APK. They are protected by row-level
 * security, not by secrecy, which is why plaintext EAS variables are correct here.
 * A `sb_secret_` key would not be, and is rejected below.
 */

// Static reads, not a dynamic lookup: this file is not bundled, but the same
// habit that broke src/backend/client.ts is not worth practising anywhere.
const VALUES = {
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
};

const problems = [];

for (const [name, value] of Object.entries(VALUES)) {

  if (!value) {
    problems.push(`${name} is missing`);
    continue;
  }
  if (/[<>]/.test(value)) {
    problems.push(`${name} still contains angle brackets — a template was never filled in`);
    continue;
  }
  if (value.trim() !== value) {
    problems.push(`${name} has leading or trailing whitespace`);
  }
}

const url = VALUES.EXPO_PUBLIC_SUPABASE_URL;
if (url && !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url.trim())) {
  problems.push(
    `EXPO_PUBLIC_SUPABASE_URL is not a Supabase project URL (got "${url.trim()}")`,
  );
}

const key = VALUES.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (key) {
  const k = key.trim();
  if (k.startsWith('sb_secret_')) {
    // The one failure mode worse than a missing key: a secret key inlined into
    // every APK, bypassing RLS for anyone who unzips it.
    problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is a SECRET key. It must never ship in a build.');
  } else if (k.startsWith('eyJ')) {
    problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is a legacy anon JWT; use the sb_publishable_ key.');
  } else if (!k.startsWith('sb_publishable_')) {
    problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY does not look like a publishable key.');
  }
}

if (problems.length > 0) {
  console.error('\n✖ Backend configuration check FAILED\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\n  In an EAS build these come from the profile\'s environment variables:\n' +
      '    npx eas-cli env:list --environment preview\n' +
      '    npx eas-cli env:set --name <NAME> --value <VALUE> \\\n' +
      '      --visibility plaintext --scope project --environment <preview|development|production>\n' +
      '  Locally they come from app/.env (see app/.env.example).\n',
  );
  process.exit(1);
}

console.log('✓ Backend configuration present:');
for (const [name, raw] of Object.entries(VALUES)) {
  const v = raw.trim();
  // The URL is fine to print; the key is public too, but there is no reason to
  // splash it across build logs.
  console.log(`    ${name} = ${name.endsWith('URL') ? v : `${v.slice(0, 18)}…(${v.length} chars)`}`);
}
