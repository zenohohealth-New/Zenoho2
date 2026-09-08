/**
 * The Supabase client (D-031).
 *
 * Three things are deliberate here:
 *
 *  - **Session storage is the existing SQLite `app_kv` table**, not AsyncStorage.
 *    D-020 says one on-device store; adding a second key/value engine just to
 *    hold a session token would have meant a new dependency and a second thing
 *    to wipe on account deletion.
 *  - **`fetch` is the guarded one.** Every request the client makes — auth,
 *    PostgREST, functions — goes through the host and body checks (D-010, AC-9).
 *  - **The publishable key is public by design.** Safety comes from row-level
 *    security, not from the key being secret. The service-role key never appears
 *    in this app at all.
 */
import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { kvGet, kvSet } from '../storage/kv';
import { guardedFetch, setAllowedOrigin } from '../net/guard';

const URL_VAR = 'EXPO_PUBLIC_SUPABASE_URL';
const KEY_VAR = 'EXPO_PUBLIC_SUPABASE_ANON_KEY';

// Static access, deliberately: Metro inlines `process.env.EXPO_PUBLIC_*` at build
// time only when it is written out literally. A dynamic lookup compiles fine and
// then reads undefined on the device.

export class BackendNotConfiguredError extends Error {
  constructor(detail: string) {
    super(`Backend is not configured: ${detail}`);
    this.name = 'BackendNotConfiguredError';
  }
}

/**
 * Read and sanity-check the environment. Fails loudly and specifically rather
 * than letting an unfilled template reach the network — the T-003 setup arrived
 * with the key still wrapped in angle brackets, and a vague error there costs
 * more time than a precise one.
 */
export function readBackendEnv(): { url: string; key: string } {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new BackendNotConfiguredError(`${URL_VAR} is missing`);
  if (!key) throw new BackendNotConfiguredError(`${KEY_VAR} is missing`);
  if (/[<>]/.test(url) || /[<>]/.test(key)) {
    throw new BackendNotConfiguredError(
      'a value still contains angle brackets — the template was never filled in',
    );
  }
  if (key.startsWith('sb_secret_')) {
    throw new BackendNotConfiguredError(
      'that is the SECRET key. It bypasses row-level security and must never ship in the app.',
    );
  }
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) {
    throw new BackendNotConfiguredError(`${URL_VAR} is not a Supabase project URL`);
  }
  return { url, key };
}

/** Session persistence backed by the one SQLite store (D-020). */
const sqliteAuthStorage = {
  getItem: (key: string) => kvGet(`auth.${key}`),
  setItem: (key: string, value: string) => kvSet(`auth.${key}`, value),
  removeItem: (key: string) => kvSet(`auth.${key}`, ''),
};

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client !== null) return client;

  const { url, key } = readBackendEnv();
  setAllowedOrigin(url);

  client = createClient(url, key, {
    auth: {
      storage: sqliteAuthStorage,
      persistSession: true,
      autoRefreshToken: true,
      // No deep-link callback in v1: email OTP is a code typed into the app,
      // not a magic link, so there is no URL to detect (D-032).
      detectSessionInUrl: false,
    },
    global: { fetch: guardedFetch },
  });
  return client;
}

/** Test seam, and used after account deletion so no stale session lingers. */
export function __resetSupabaseForTests(): void {
  client = null;
}
