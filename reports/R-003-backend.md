# R-003 · Backend: identity, sync of derived states, privacy enforcement

Task: tasks/T-003-backend.md · Maker: Claude Code · Status set to IN_REVIEW
Spec sections read: §7, §8, §11, §13, §14 · Decisions: D-007, D-010, D-011, D-020, D-023,
D-025, D-027, D-030, and D-031/D-032/D-034 recorded here
Date: 2026-09-08

> **Headline for the checker: the backend is real and proven; the app has never
> successfully talked to it.**
>
> Server-side is done and verified against the live Mumbai project — schema applied, RLS proven
> 8/8 by a suite that runs against the real database, edge function deployed with its secrets in
> place. **AC-3.3 and AC-3.9 are MET.**
>
> App-side, no acceptance criterion involving a round trip has been demonstrated. As of this
> report the four application tables hold **zero rows**: nothing the app produced has ever
> reached the server. Three device runs were consumed by defects rather than evidence, and the
> fourth is deliberately withheld under D-038 until the auth email templates are confirmed.
>
> Status IN_REVIEW rather than IN_REVIEW-COMPLETE, and the gap is evidence, not code.

---

## 1. What changed

**Decisions.** D-031 (Supabase, ap-south-1 Mumbai) and D-032 (email OTP) recorded as the task
specified. D-034 records the founder's ruling on clock skew. Later in the task: D-035 (legacy
project found and left alone), D-037 (public config in EAS env vars), D-038 (prove it before a
device run — wording drafted by me, the text was never supplied) and D-039 (custom SMTP).
D-033 was a numbering gap and has since been filled in; **D-036 remains one**, with no text in
any message, and is left open rather than invented.

**Spec §8** gains `daily_states.device_clock_offset_min`, with a note that `computed_at` is
server-set and never sent by the client.

**Schema and RLS** (`backend/migrations/0001_init.sql`). Four tables per §8, with `pod_id` and
`witness_user_id` present but nullable so T-004 adds tables rather than rewriting columns.

Two choices worth the checker's attention:

- **`daily_states` carries no `user_id`.** Spec §7 lists what the server may hold about a night
  and a user id is not on it, so ownership is transitive through `commitments.user_id`. RLS
  policies use an `exists` subquery instead of a column compare. Slightly more SQL, exactly the
  columns the spec allows.
- **RLS is `enable`d *and* `force`d on every table**, and there is no policy for the `anon` role
  anywhere. An unauthenticated request therefore reads nothing (AC-3.9) — not because a policy
  denies it, but because no policy admits it. `force` additionally applies policies to the table
  owner, so a future function cannot quietly bypass them.

**Delete** (`backend/functions/delete-account`). The caller is identified with *their own* token
under RLS; only then does a service-role client delete by that id. The app can ask "delete me"
and cannot name anyone else, because the id never comes from the request body. Idempotent by
construction: deleting nothing is a success.

**Client.** Session storage is the existing SQLite `app_kv` table, not AsyncStorage — D-020 says
one on-device store, and this avoided both a dependency and a second thing to wipe on deletion.
The client is handed `guardedFetch`, so auth, PostgREST and function calls all pass the host and
body checks.

**Sync.** Every derived night is queued, never sent directly, so there is one code path to the
server and one place offline behaviour lives (AC-3.6). The queue is keyed by night date, and the
server upsert is on `(commitment_id, night_date)`, so re-deriving replaces rather than duplicates
and draining twice is harmless.

**Screens.** Sign-in (email → numeric code; length is a project setting, so the screen accepts
6–10 digits rather than assuming) and Settings (sign in when signed out; sign out, export and
delete when signed in, plus the D-027 "what leaves this phone" paragraph).

---

## 2. D-034 as implemented

The ruling was (c): server sets `computed_at`, client sends `device_clock_offset_min`.

`computed_at` is now **explicitly listed in `FORBIDDEN_KEYS`**, alongside `computedAt`. That is
the part worth noticing: the exemption was refused, so the code now actively rejects it rather
than merely not sending it. A future contributor who adds `computed_at` to a payload gets a
failing test, not a silent widening of the boundary.

`device_clock_offset_min` is whole minutes of device-minus-server time from a one-time probe
against the `server_now()` function. The probe places the server's instant at the midpoint of the
round trip, so a slow network does not read as a skewed clock. It caches, because the offset is a
property of the phone and drifts slowly; re-probing nightly would buy a round trip per night for
a number that barely moves. **A failed probe records null, not zero** — "not measured" and
"measured as no skew" are different facts and the distribution report will need to tell them
apart.

---

## 3. Tests run

| Gate | Command | Result |
|---|---|---|
| Unit + fixtures | `npm test` | **136 passed, 2 skipped**, 11 files |
| Typecheck | `npm run typecheck` | **clean** |
| Lint | `npm run lint` | **clean** |
| Manifest permissions | `npm run check:manifest` | **passes** |
| Backend config | `npm run check:env` | **passes**; 5 failure modes each verified to fail |
| RLS on live project | `supabase db query --file backend/tests/rls_denial.sql` | **8/8 ALL PASS** |
| **Live backend** | `supabase db push`, `functions deploy`, `db query` | **applied and verified on Zenoho2-new** |
| Preview APK | `eas build --profile preview` | **built** — latest `e1a3bdd4` |

**`tests/no-network.test.ts` was rewritten, not deleted.** I flagged this in advance last
session: T-003 makes the T-002 invariant ("nothing in the app reaches the upload boundary") false
by design. The replacement asserts what still matters and is arguably stronger — the Supabase
client is created in exactly one file, that file is handed `guardedFetch` rather than the global
one, `toServerRow` is the only way a server row is built, and no source file contains a secret
key or a hard-coded project URL.

**Lint caught a real bug, not a style nit.** `process.env` was being read dynamically
(`process.env[URL_VAR]`). Metro inlines `EXPO_PUBLIC_*` only when written literally, so that
compiles cleanly and then reads `undefined` on the device. It is exactly the class of failure
that cost two device runs in T-001, caught this time before a build.

Three of my own new tests failed first and all three were faults in the tests, not the code:
Windows path separators, a regex matching the word `toServerRow` inside a comment, and flagging
`client.ts` for containing the string `sb_secret_` in the guard that *rejects* such a key. I
tightened the tests rather than loosening the assertions.

---

## 4. Tests passed / failed

**Passed: 136. Failed: 0. Skipped: 2** (the Layer 2 manifest assertions, covered by
`npm run check:manifest`).

The honest reading: this suite proves the payload whitelist, the guard's two rules, the queue's
shape and the sync logic's branching. RLS is proven separately and for real, by the SQL suite
against the live database. What remains unproven by any of it is **auth, and every round trip
the app makes** — none of that has executed once.

---

## 5. Assumptions

1. **`server_now()` is the skew probe.** Added in the migration as `security invoker`, granted to
   `authenticated` only, revoked from `anon` — an unauthenticated caller learns nothing, not even
   the time.
2. **One commitment row per device**, cached locally. Changing a commitment inserts a new row
   rather than updating, so the history of what was promised is not rewritten. A device that
   changes its commitment will create a second server commitment; nights attach to whichever was
   current. Cycles (T-004) will need to revisit this.
3. **`users.platform` is hard-coded `'android'`** at upsert. D-013 makes Android the only
   shipping platform, and inventing a detection path for a platform that cannot be distributed
   would be waste.
4. **Export shares JSON as text** through the OS share sheet, using React Native's built-in
   `Share`. No new dependency. A large export becomes an awkward share payload; if that matters,
   a file-based export needs `expo-file-system`.
5. **Sync failures are silent to the member.** A queued night is not an error worth interrupting
   someone with — the night itself derived and stored correctly, and the count is visible in
   Settings. If the queue can be stuck for days without anyone noticing, that is a product
   question I would rather have asked than answered myself.

---

## 6. Unresolved issues

1. **The app has never reached the server.** See §9: four empty tables. Everything between
   `queueNight` and a row appearing is unexercised — the sync queue, the drain, the upsert, the
   commitment bootstrap, the clock probe. That is the whole of the risk in this report.
2. ~~AC-3.3 wants an RLS denial test against a real instance.~~ **CLOSED.**
   `backend/tests/rls_denial.sql` runs against the live project, impersonates two users the way
   PostgREST does, and rolls back. It opens by asserting the seed row is visible to the owner,
   so a later "0 rows" means denial rather than an empty table. It is not yet wired into CI,
   because it needs project credentials a public repo cannot hold.
3. ~~The migration has never been applied.~~ **CLOSED** — applied to Zenoho2-new and verified
   by querying the live database, not by re-reading the file.
4. **Email OTP deliverability is unmeasured** (task open item). Rate limit now known: 2/hour
   (D-039). Whether a code actually arrives, and in inbox or spam, is untested.
5. **`frozen` server-side enforcement** (task open item, recommend-only): **recommended.** A
   trigger rejecting updates to a row already `frozen = true` is about ten lines, and without it
   the freeze rule is a client-side convention that any client build can ignore. Not implemented,
   per the task.
6. **The `device_clock_offset_min` distribution** cannot be reported until nights sync — no
   night has synced.
7. **D-036 has no text in any message**, and D-038's wording is my draft. Both flagged in the
   decision log rather than invented.

---

## 7. Risks

- **This is the largest volume of unexecuted code in the project so far** — a schema, an RLS
  policy set, an edge function, an auth flow and a sync queue, none of which has run. T-001's
  pattern was that integration facts, not logic errors, caused every device failure. RLS policy
  mistakes fail in the most expensive direction: they usually fail *open*, and a green client
  test says nothing about them.
- **The publishable key was never filled in**, and the first thing the app does with it is talk
  to a server. `readBackendEnv` therefore fails loudly and specifically — angle brackets, secret
  key, wrong host shape each get their own message — because a vague failure here would cost more
  time than the check.
- **A wrong key type would be worse than a missing one.** If an `sb_secret_` key ever reached
  `.env`, it would be inlined into the JS bundle and ship to every device, bypassing RLS
  entirely. `readBackendEnv` refuses it, and a test asserts no source file contains one.
- **Local and server can diverge silently.** Local remains the source of truth for display, so a
  permanently failing sync looks like nothing at all to the member. Settings shows the pending
  count; nothing else surfaces it.

---

## 8. Recommended next step

1. **Fill in the key.** In `C:\Zenoho2\app\.env`, replace the `<sb_...>` placeholder with the
   real `sb_publishable_...` value. The file is already correctly named and gitignored. I will
   verify the shape without printing it.
2. **Apply the migration** and deploy the function:
   ```bash
   supabase db push
   supabase functions deploy delete-account
   ```
3. **Then, in order:** sign in on the S26 (AC-3.1), derive a night and check the row and its
   column list via SQL (AC-3.2), airplane-mode a derivation and watch it arrive (AC-3.6), export
   (AC-3.7), delete twice (AC-3.8), and try an anon read (AC-3.9).
4. **Write the AC-3.3 RLS denial test against a local Supabase CLI instance**, once there is a
   working instance to write it against.
5. **Build the T-003 preview APK** (D-023) after the key is in — an APK built now would embed the
   placeholder.

---

## 9. Devices used (physical, with OS version)

| | |
|---|---|
| Device | **Samsung Galaxy S26 Ultra**, Android 16 / One UI 8.5, build `BP4A.251205.006` (D-014) |
| Backend | Supabase **Zenoho2-new** `kjmaivclilrovfvqvjqr`, ap-south-1 (D-031, D-035) |
| iOS | none — **DEFERRED** (D-013), and unshippable until an Apple account exists (D-021) |

### Build and run log

| Build | Outcome |
|---|---|
| `a2e8fccc` | **Halted on three defects.** No sign-in path anywhere in the app; stale Home copy claiming Zenoho "sends nothing anywhere", false since T-003; morning-sync verdict reporting MISSED for a notification that had actually fired. All three fixed. |
| `f815ea27` | **Unusable.** Reported "Backend is not configured" on the device: EAS cloud builds never receive the gitignored `app/.env`. Fixed by D-037. |
| `9f5be4d2` | Config loaded correctly. Not exercised — pre-flight found the OTP defect below before a run was attempted. |
| `e1a3bdd4` | Current build. **Not yet run**, withheld under D-038. |

### What the server says, which is the part that matters

```
users 0 · commitments 0 · daily_states 0 · push_tokens 0     (auth.users: 1)
```

One auth user exists, from a code request at some point. **Every application table is empty.**
No commitment, no night, no row of any kind has been written by the app. That single fact is
the honest summary of app-to-server progress.

### Acceptance criteria

| Criterion | State |
|---|---|
| **AC-3.1** sign in, persists across kill | **NOT VERIFIED** — sign-in has never succeeded |
| **AC-3.2** row exists with exactly the §7 columns | **PARTIAL.** The *schema* is verified from the live database: `daily_states` = id, commitment_id, night_date, state, integrity, source_id, wear_presence, deviation_min, frozen, device_clock_offset_min, computed_at — exactly §7 plus D-034, with no user_id and no raw health column. No row has been written, so the write path is unproven. |
| **AC-3.3** RLS denial on a real instance | **MET** — 8/8, `backend/tests/rls_denial.sql` |
| **AC-3.4** guard rejects bad body and bad host | **PARTIAL** — 17 tests pass; the live half needs a real request |
| **AC-3.5** intercept a full session | **NOT VERIFIED** |
| **AC-3.6** offline derive syncs unattended | **NOT VERIFIED** |
| **AC-3.7** export is own rows, §7 columns only | **NOT VERIFIED** |
| **AC-3.8** delete is complete and idempotent | **PARTIAL** — the function is deployed and holds `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`; never invoked |
| **AC-3.9** anon reads nothing | **MET** — part of the same 8/8 suite |

Two met, three partial, four not verified.

### The D-038 pre-flight, which is why there was no fourth run

Reading the live auth config rather than trusting the app found a blocker that would have
consumed the entire email budget without a single successful sign-in:

- **`auth.email.otp_length = 8`.** The sign-in screen hard-coded `/^\d{6}$/` *and* capped the
  input at `maxLength={6}`, so the correct code could not even be typed. Fixed to accept 6–10
  and let the server decide; OTP length is a project setting, and a client stricter than the
  server about a value the server owns is a bug waiting for a config change.
- **My first fix was silently wrong**, and worth recording because it is invisible on review:
  written as ``new RegExp(`^\d{...}$`)``, the backslash is dropped inside a template literal,
  yielding `/^d{6,10}$/` — which matches `"dddddd"` and no real code. Caught by executing the
  pattern rather than reading it. It is now a literal and a test asserts it stays one.
- **`auth.rate_limit.email_sent = 2` per hour**, only adjustable once custom SMTP is enabled.
  Recorded as D-039; custom SMTP is required before any invite goes out.
- **`enable_confirmations = true`**, so a new user receives *Confirm signup*, not *Magic Link*.
  Fixing only one template would work for the founder and fail for every pod member.
- **`site_url = http://localhost:3000`** — a dead address on a phone. Both templates in
  `backend/templates/` therefore carry the code and no link at all.
- **A cold-install dead-end**: Settings was gated on `commitment !== null`, so a signed-out user
  with no commitment fell through to an endless spinner.

Remaining before a run is worth spending: paste both templates, confirm a numeric code arrives,
and ideally configure Resend so the 2/hour ceiling stops mattering.

