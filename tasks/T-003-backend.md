# T-003 · Backend: identity, sync of derived states, privacy enforcement

Status: **DONE pending checker report review** (T-003 + T-003-R)
Owner: Claude Code (maker) · Reviewer: Claude Web (checker)
Reports: reports/R-003-backend.md, reports/R-003-R.md · Handoff: reports/CC-HANDOFF-2026-09-08.md

Device run 2026-09-08 on APK e1a3bdd4 (S26 Ultra / Android 16):
AC-3.1, AC-3.2, AC-3.7, AC-3.8 PASS. AC-3.3 and AC-3.9 MET by the SQL suite (8/8).

Device run 2026-09-09 on APK 2eb5c840 (same device):
**AC-R1, AC-R2, AC-R3, AC-R6 PASS. DEF-003-01 CLOSED.** AC-R4 accepted - the 2026-09-09 row holds
exactly the spec 7 columns plus device_clock_offset_min, state NO_DATA (R-003-R 7a).

AC-3.5: **closed at the key level.** PostgREST validates payload columns before authorization
(PGRST204 at HTTP 400, ahead of the RLS 42501 at 401), so a body carrying an HR, RHR or epoch-ms
key is refused and writes nothing. The row exists, therefore the device's body carried only
daily_states columns. Proven against the live project, not against mocks. See R-003-R 7.

Carried forward, NOT a T-003 gate:
- **AC-3.5-v** - value-level proof. Proxy the phone (mitmproxy) and capture one KEPT night's
  upload; paste the body verbatim and confirm no timestamp, HR or RHR value. The key-level proof
  constrains keys, not values, and it was taken on a NO_DATA night with a null source_id - the
  weakest case. **LAUNCH GATE: must pass before any invite goes out.** Recorded in CLAUDE.md
  under External contracts.
- **AC-R5** - offline with Health Connect permission revoked. Deferred to T-005 by the checker.

Only the checker marks this DONE.

## Goal
The app gets an identity and a server, and the server learns only what spec §7 allows. After this task a user can sign in, their derived nights sync up, they can export and delete everything, and a test proves that no raw sleep or heart-rate value can reach the server and that no user can read another user's rows. Pods, witnesses and reactions are NOT in this task (T-004).

## D-031 (recorded by this task) · Backend provider
Supabase, region **ap-south-1 (Mumbai)**. Rationale: managed Postgres + auth + RLS + edge functions + pg_cron in one free-tier project; Mumbai region keeps health-derived data in India (DPDP posture); no server process for a solo founder. Anon key is public by design and lives in `app/.env` only; service-role key never leaves Supabase dashboard / edge-function secrets.

## D-032 (recorded by this task) · Sign-in method
Email one-time code (Supabase email OTP). No phone OTP (needs a paid SMS provider), no Google sign-in in v1 (OAuth client setup is pure friction for 5–8 gym users). Display name only; no profile photo.

## Deliverables
1. **Migrations** in `backend/supabase/migrations/` (D-044; was `backend/migrations/`) creating: `users`, `commitments`, `daily_states`, `push_tokens` per spec §8 (including `device_clock_offset_min`, and `computed_at` set server-side per D-034) — with the columns for pods/witness present but nullable (`pod_id`, `witness_user_id`) so T-004 adds tables, not column rewrites. `daily_states` server columns are exactly the §7 list: state, integrity, source_id, wear_presence, deviation_min, night_date, commitment_id, frozen, computed_at. Nothing else.
2. **RLS policies** in the same migrations: users read/write own rows only; `daily_states` readable by owner only (witness view arrives in T-004); anon role has no table access.
3. **Sign-in screen** — email → code → in. Sign-out. Session persisted. (Length is not fixed: `otp_length` is a project setting and this project issues 8.)
4. **Sync** — after every local derivation, upsert the derived row via `toServerRow` (the existing whitelist) to `daily_states`. Offline-tolerant: queue locally, retry on next foreground. Server is a mirror of local; local remains the source of truth for display in v1.
5. **Network guard extended** — the runtime guard now allows exactly one host (the Supabase project URL) and still rejects any body containing forbidden keys / ISO instants / epoch ms. Test proves both.
6. **Export** — Settings → "Export my data" produces a JSON of the user's own server rows, shared via the OS share sheet.
7. **Delete account** — edge function with service-role key performs hard delete of all rows for the caller; local DB wiped; sign-out. Must be idempotent.
8. **Settings screen** — sign-out, export, delete, and a plain-language "what leaves this phone" paragraph (D-027 copy rule).
9. **Preview APK** (D-023) and `reports/R-003-backend.md`.

## Constraints
- No pods, invites, witness, reactions, cycles, notifications beyond what exists.
- Migrations are the only way schema changes happen; no dashboard-only changes.
- Keys via env only; `.env` gitignored; `.env.example` committed with placeholders.
- Public repo: nothing in migrations or code may contain project ref, keys, or the founder's data.
- Minimal dependencies (`@supabase/supabase-js` and its RN storage adapter expected; justify anything else).

## Acceptance criteria
- **AC-3.1** Sign in with email code on the S26; kill app; reopen; still signed in.
- **AC-3.2** After a derivation, the matching `daily_states` row exists on the server with exactly the §7 columns — verify via SQL and paste the column list.
- **AC-3.3** RLS denial proven by test: as user A, `select` on user B's `daily_states` returns zero rows and `insert` into B's rows fails. Test runs against a real Supabase instance (local CLI or the project), not a mock.
- **AC-3.4** Network guard: a test that attempts to send `sleep_start`, an ISO instant, and an epoch-ms number in a payload is rejected; a request to any host other than the Supabase URL is rejected.
- **AC-3.5** Intercept a full session on device (proxy or Supabase logs): no request body contains a timestamp inside the sleep window, an HR value, or an RHR value.
- **AC-3.6** Offline: derive with airplane mode on, go online, row appears on server without user action.
- **AC-3.7** Export JSON contains only the user's own rows and only §7 columns.
- **AC-3.8** Delete: after delete, SQL shows zero rows for that user id across all tables; the app is signed out and local DB empty; re-running delete does not error.
- **AC-3.9** Anon role: a request with the anon key and no session cannot read any table.

## Open items to surface
- Whether Supabase email OTP deliverability to Gmail is reliable enough (spam folder rate) for onboarding; report what you observe.
- Report the distribution of `device_clock_offset_min` (D-034 supersedes the original clock-skew item: the server sets `computed_at`, so there is no device timestamp to compare).
- Whether `frozen` should be enforced server-side (trigger) as well as client-side. Recommend, do not implement.

## Closing block
Mandatory, per CLAUDE.md.
