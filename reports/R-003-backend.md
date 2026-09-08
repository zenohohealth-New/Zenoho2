# R-003 · Backend: identity, sync of derived states, privacy enforcement

Task: tasks/T-003-backend.md · Maker: Claude Code · Status set to IN_REVIEW
Spec sections read: §7, §8, §11, §13, §14 · Decisions: D-007, D-010, D-011, D-020, D-023,
D-025, D-027, D-030, and D-031/D-032/D-034 recorded here
Date: 2026-09-08

> **Headline for the checker: none of the nine acceptance criteria has been verified.** Every
> one of AC-3.1 through AC-3.9 needs a live Supabase connection, and the publishable key in
> `app/.env` is still the unfilled template — 48 characters beginning `<sb_`, angle brackets
> included. The code, the migrations and the edge function are complete and every local gate is
> green (127 tests, typecheck, lint, manifest check), but **green gates here mean the code
> compiles and reasons correctly, not that the backend works.** Given that two of three T-001
> device runs failed on integration facts invisible to exactly these gates, treat this report as
> a design review, not a delivery.

---

## 1. What changed

**Decisions.** D-031 (Supabase, ap-south-1 Mumbai) and D-032 (email OTP) recorded as the task
specified. D-034 records the founder's ruling on clock skew. A **D-033 gap** is flagged rather
than assumed deliberate — this is the third such gap, and the previous two, D-015 and D-021,
both turned out to be real decisions taken in chat and never written down.

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

**Screens.** Sign-in (email → 6-digit code) and Settings (sign out, export, delete, and the
D-027 "what leaves this phone" paragraph).

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
| Unit + fixtures | `npm test` | **127 passed, 2 skipped**, 10 files |
| Typecheck | `npm run typecheck` | **clean** |
| Lint | `npm run lint` | **clean** |
| Manifest permissions | `npm run check:manifest` | **passes** |
| **Live backend** | — | **NOT RUN — no usable key** |
| Preview APK | — | **not built for T-003** (built for T-002 as `83941541`) |

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

**Passed: 127. Failed: 0. Skipped: 2** (the Layer 2 manifest assertions, covered by
`npm run check:manifest`).

The honest reading: this suite proves the payload whitelist, the guard's two rules, the queue's
shape and the sync logic's branching. It proves **nothing** about Postgres, RLS, auth, or the
edge function, because none of those ran.

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

1. **Nothing is verified.** See §9. This is the whole of the risk in this report.
2. **AC-3.3 wants an RLS denial test against a real instance.** That needs credentials at test
   time, in a public repo, which means either a local Supabase CLI instance in CI or an
   env-gated test that skips when absent. A skipping test is not a gate. **I have not written it
   yet** — writing it against an API I cannot run would produce a test that passes for the wrong
   reasons. Recommend: local Supabase CLI, so it runs everywhere without secrets.
3. **The migration has never been applied.** It is plain SQL and reads correctly, but "reads
   correctly" is what T-002 said about the SQLite layer that then needed a device run to prove.
4. **Email OTP deliverability is unmeasured** (task open item) — no email has been sent.
5. **`frozen` server-side enforcement** (task open item, recommend-only): **recommended.** A
   trigger rejecting updates to a row already `frozen = true` is about ten lines, and without it
   the freeze rule is a client-side convention that any client build can ignore. Not implemented,
   per the task.
6. **The `device_clock_offset_min` distribution** cannot be reported until nights sync.

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

| Platform | Device | State |
|---|---|---|
| Android | **Samsung Galaxy S26 Ultra**, Android 16 / One UI 8.5 (D-014) | **no T-003 build, no T-003 device run** |
| iOS | none | **DEFERRED** (D-013, and unshippable per D-021) |

| Criterion | State |
|---|---|
| AC-3.1 sign in, persists across kill | **NOT VERIFIED** |
| AC-3.2 row exists with exactly the §7 columns | **NOT VERIFIED** |
| AC-3.3 RLS denial against a real instance | **NOT VERIFIED — test not yet written** (§6.2) |
| AC-3.4 guard: bad body and bad host rejected | **half met** — proven by test; live half outstanding |
| AC-3.5 intercept a full session on device | **NOT VERIFIED** |
| AC-3.6 offline derive syncs unattended | **NOT VERIFIED** |
| AC-3.7 export is own rows, §7 columns only | **NOT VERIFIED** |
| AC-3.8 delete is complete and idempotent | **NOT VERIFIED** |
| AC-3.9 anon can read nothing | **NOT VERIFIED** |

**One of nine is half met. Nothing else in T-003 has been proven.** The task is code-complete and
evidence-empty, and I would rather say so plainly than let a green gate table imply otherwise.

Status set to **IN_REVIEW**, not IN_REVIEW-COMPLETE: with §9 in this state there is nothing here
a checker could responsibly sign off.
