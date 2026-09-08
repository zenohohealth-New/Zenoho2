# Claude Code session handoff — 2026-09-08

Written at the close of the session that built T-003. Read this before `reports/R-003-backend.md`:
R-003 was finalised at 15:11 IST, **before** the founder's device run at ~16:00, so parts of it
are now out of date and this file supersedes it where they disagree.

---

## 1. Head

| | |
|---|---|
| Branch | `main` |
| HEAD | see the closing block for this session's final hash; at the time of writing, `dc8e473` plus the commit this file lands in |
| Remote | `https://github.com/zenohohealth-New/Zenoho2.git` — **public** |
| Tree | clean, verified by `git status --porcelain` |
| `ls-remote` | matches local, verified separately from the push output |

One push gotcha worth knowing: `git push … | tail` returned exit 0 and printed nothing while the
push had not happened. Verify a push with `git ls-remote`, never with the push command's own exit
status through a pipe.

---

## 2. Files changed in this session

This Claude Code session created the repository from nothing (root commit `3ac8f9e`, 2026-09-07
16:30) and ran through T-001, T-002 and T-003 — 91 files in total. Listing all 91 would bury the
part a fresh session needs, so what follows is **today's work only** (`daf8ace..HEAD`, the T-003
range). For T-001/T-002 files, read R-001 and R-002.

### Backend (new)
| File | Why |
|---|---|
| `backend/migrations/20260908000001_init.sql` | The whole schema: users, commitments, daily_states, push_tokens; RLS enabled **and** forced; `server_now()` for the clock probe |
| `backend/functions/delete-account/index.ts` | AC-3.8 hard delete; identifies the caller under RLS with their own token, then deletes with service-role |
| `backend/tests/rls_denial.sql` | AC-3.3/AC-3.9, 8 checks against the live database; opens by asserting the seed row is visible so a later "0 rows" means denial, not emptiness |
| `backend/supabase/config.toml`, `.gitignore` | CLI project config; `.temp` (which holds the project ref) is ignored |
| `backend/templates/magic-link.html`, `confirm-signup.html` | Paste-ready auth emails carrying `{{ .Token }}` and no link, because Site URL is `localhost:3000` and dead on a phone. **Still not pasted into the dashboard.** |

### App (new)
| File | Why |
|---|---|
| `app/src/backend/client.ts` | Supabase client, `backendConfigured()` |
| `app/src/backend/clockSkew.ts` | D-034 offset probe; returns `null` on failure, never 0 |
| `app/src/backend/sync.ts` | `ensureRemoteCommitment`, `queueNight`, `drainQueue`, `exportOwnRows`, `deleteAccount` |
| `app/src/backend/syncQueue.ts` | SQLite outbound queue keyed by night date |
| `app/src/ui/SignInScreen.tsx` | Deliverable 3 |
| `app/src/ui/SettingsScreen.tsx` | Deliverable 8: sign-in/out, export, delete, D-027 paragraph |
| `app/scripts/check-env.mjs`, `load-env.cjs` | D-037 build-time config gate, wired to `eas-build-post-install` |
| `app/.env.example` | Placeholders, per the task constraint |
| `tests/otp-format.test.ts` | Regression for the OTP-length defect |

### App (modified)
| File | Why |
|---|---|
| `app/App.tsx` | Router; session recovery on boot; sign-in route for signed-out users; the sync call after derivation; Settings no longer gated on having a commitment |
| `app/src/net/guard.ts` | Single allowed origin; forbidden keys extended to `computed_at`/`computedAt` |
| `app/src/net/payload.ts` | `toServerRow` gained `device_clock_offset_min` |
| `app/src/storage/db.ts` | Migration for `sync_queue` |
| `app/src/storage/kv.ts` | Keys for the cached remote commitment id and clock offset |
| `app/src/engine/morningSync.ts`, `morningSyncTime.ts` | Fixed a false MISSED verdict; added `lastScheduledMs` and `NOT_YET_OBSERVED` |
| `app/src/ui/HarnessScreen.tsx`, `HistoryScreen.tsx` | Diagnostics for pending sync and clock offset; stale copy removed |
| `app/eslint.config.js`, `package.json`, `package-lock.json` | Lint config and scripts (`check:env`, `check:manifest`) |
| `tests/netguard.test.ts`, `no-network.test.ts`, `morning-sync.test.ts` | Coverage for the above |

### Docs
| File | Why |
|---|---|
| `decisions/DECISIONS.md` | D-031 … D-039 |
| `spec/ZENOHO2-V1-SPEC.md` | §8 gained `device_clock_offset_min` |
| `tasks/T-003-backend.md` | Status block; deliverable 3 no longer claims a digit count |
| `reports/R-003-backend.md` | The T-003 report |
| `CLAUDE.md` | "External contracts" section |
| `.gitignore` | `.vitest/` — see §9 |

---

## 3. T-003 deliverables: what is actually in the code

Blunt, per deliverable, from reading the code rather than the task.

| # | Deliverable | State |
|---|---|---|
| 1 | Migrations | **IMPLEMENTED and applied.** Schema verified by querying the live database. `daily_states` columns are exactly spec §7 plus `device_clock_offset_min` (D-034): no `user_id`, no raw health column. `pod_id`/`witness_user_id` present and nullable so T-004 adds tables, not column rewrites. |
| 2 | RLS policies | **IMPLEMENTED and proven.** `enable` **and** `force`, no anon policies, 8/8 on the live project. |
| 3 | Sign-in screen | **IMPLEMENTED and now proven on device** (~16:00 IST, first successful end-to-end sign-in). Accepts 6–10 digits; session persists across a kill. |
| 4 | Sync, offline-tolerant | **PARTIAL — and the missing half is the half that was specified.** See below. |
| 5 | Network guard extended | **IMPLEMENTED.** Single allowed origin; forbidden keys, ISO instants and epoch-ms integers rejected with no exemptions. 15/15 unit tests. Proven in tests, not yet against live traffic (that is AC-3.5). |
| 6 | Export | **IMPLEMENTED**, and PASSED on device. |
| 7 | Delete account | **IMPLEMENTED and deployed**, and PASSED on device. |
| 8 | Settings screen | **IMPLEMENTED**, including the D-027 paragraph. |
| 9 | Preview APK + report | **IMPLEMENTED.** APK `e1a3bdd4`; report at `reports/R-003-backend.md`. |

### Deliverable 4, stated plainly

The task says: *"Offline-tolerant: queue locally, retry on next foreground."*

- **"Queue locally" — implemented.** `app/src/backend/syncQueue.ts` is a real SQLite queue keyed
  by night date, with attempt counts and last error retained. `queueNight` always queues and
  never sends directly, so there is exactly one path to the server. Re-deriving a night replaces
  its pending payload; the server upsert is on `(commitment_id, night_date)`, so draining twice
  is harmless.
- **"Retry on next foreground" — NOT IMPLEMENTED.** There is no `AppState` listener anywhere in
  the app. `grep -rn "AppState" app/src app/App.tsx` returns nothing. `drainQueue()` is called
  from exactly one place, `app/App.tsx:149`, inside the "Check last night" handler.

The consequence: the queue drains only when the user taps "Check last night" **while online**.
Nothing drains it on returning to the app. **AC-3.6 could not have passed as written** — "go
online, row appears on server without user action" — regardless of DEF-003-01, because the code
that would make it happen does not exist. The comment at the top of `syncQueue.ts` claims "the
queue drains on the next foreground"; that comment is **wrong** and describes an intention, not
the code beneath it. Do not trust it.

This is a specification-to-implementation gap I did not catch before reporting, and it is not
the same thing as the device defect below. Both need fixing; fixing DEF-003-01 alone will not
make AC-3.6 pass.

---

## 4. Device run results (founder, 2026-09-08)

Founder-supplied. First successful end-to-end sign-in at ~16:00 IST, on APK `e1a3bdd4`,
S26 Ultra, Android 16.

| Criterion | Result |
|---|---|
| AC-3.1 sign in, persists across kill | **PASS** |
| AC-3.2 row on server with exactly the §7 columns | **PASS** |
| AC-3.5 intercept a full session | **NOT VERIFIED** |
| AC-3.6 offline derive syncs unattended | **FAIL** — DEF-003-01 |
| AC-3.7 export is own rows, §7 columns only | **PASS** |
| AC-3.8 delete complete and idempotent | **PASS** |

AC-3.3 and AC-3.9 were already MET by the SQL suite. AC-3.4 is met in tests; its live half is
AC-3.5 and remains unverified.

**Six of nine met. AC-3.5 unverified, AC-3.6 failing.** R-003 §9 says all four application
tables held zero rows; that was true when written and is **no longer true** — the run above wrote
real rows and then deleted them via AC-3.8.

### DEF-003-01 — recorded verbatim as the founder reported it

> AC-3.6 failure, observed on APK e1a3bdd4, S26 Ultra, Android 16, signed in, airplane mode ON:
> tapping "Check last night" produces ZERO visual change — no loading state, no error, no
> verdict. Confirmed frame-by-frame across a screen recording. The same tap online correctly
> shows "Reading…" then a verdict.

What I can say without having reproduced it: the handler at `app/App.tsx:102` calls
`setBusy(true)` as its very first statement, and `busy` is passed to the Home screen at
`App.tsx:401`. A tap that reaches the handler should therefore show a loading state even offline.
"Zero visual change" suggests the tap did not reach the handler at all, or the component did not
re-render. I have **not** diagnosed this and am not guessing further — it needs the next session
with the device. Do not assume the cause is in the sync code; the sync block is wrapped in
`try/catch` and deliberately silent, which is a plausible-looking suspect that does not explain a
missing loading state.

---

## 5. Decisions recorded this session

| # | Subject | Status |
|---|---|---|
| D-031 | Supabase, ap-south-1 | DECIDED |
| D-032 | Email one-time code sign-in | DECIDED |
| D-033 | Gated roadmap | DECIDED (was a numbering gap, filled in) |
| D-034 | Clock skew: server sets `computed_at`, client sends only whole minutes | DECIDED |
| D-035 | Legacy Zenoho1 Supabase project found and left untouched | DECIDED |
| D-036 | Print the authenticated identity and stop before linking anything | DECIDED — founder's text, 2026-09-08 |
| D-037 | Public config lives in EAS environment variables | DECIDED |
| D-038 | Prove it before asking the founder to touch the phone | DECIDED — confirmed as drafted |
| D-039 | Custom SMTP for auth email | DECIDED — implemented, domain verification outstanding |
| D-040 | An unimplemented deliverable makes a task NOT_DONE, not IN_REVIEW; manually exercise every screen before reporting | DECIDED — checker, 2026-09-08 |
| D-041 | Never `git add -A`; stage explicitly by path and list every path in the report | DECIDED — checker, 2026-09-08 |

**T-003 is REOPENED**, not IN_REVIEW (D-040). AC-3.5 and AC-3.6 remain open. The checker also
ruled that the project ref in the public repo is acceptable and needs no action — §8 item 7 below
is answered and closed; do not rewrite history over it.

**No duplicate D-036 was created.** `decisions/DECISIONS.md` contains exactly one `## D-036`
heading. The placeholder that previously read "(text not supplied)" was replaced in place by the
founder's wording, not appended alongside it. Verified with `grep -c "^## D-036"` → 1.

---

## 6. Supabase config the app depends on (no secrets)

| | |
|---|---|
| Project | `Zenoho2-new` |
| Ref | `kjmaivclilrovfvqvjqr` |
| Region | `ap-south-1` (Mumbai) |
| Auth | Email one-time code; no password, no magic link, no OAuth |
| **OTP length** | **6** — changed by the founder from 8 at 15:58 IST on 2026-09-08 |
| `enable_confirmations` | `true` — a **new** user gets *Confirm signup*, not *Magic Link*. Both templates must be pasted, or the founder's flow works and every pod member's fails. |
| `site_url` | `http://localhost:3000` — dead on a phone; this is why both templates carry the code and no link |
| SMTP | Custom, via Resend (D-039) |
| SMTP sender | `onboarding@resend.dev` — Resend's **sandbox** address |
| Rate limit | The 2/hour built-in ceiling no longer applies now that custom SMTP is on |

**The sender is the live constraint.** `onboarding@resend.dev` delivers **only to
zenohohealth@gmail.com**. Mail to any other address is accepted by the API and never arrives,
with no error the app can observe. Sign-in therefore works for the founder and silently fails
for everyone else. Verifying `zenoho.com` in Resend is a prerequisite for the first invite, not
a polish item.

The OTP change to 6 does **not** break the app: `SignInScreen` accepts 6–10 digits and caps the
input at 10, so a 6-digit code is typed and validated correctly. See §8 for the stale comments
this change left behind.

---

## 7. Last Android build

| | |
|---|---|
| Build ID | `e1a3bdd4` |
| Produced by | `eas build --profile preview --platform android`, run from `app/` |
| Profile | `preview` in `app/eas.json`: `distribution: internal`, `buildType: apk` |
| Config source | **EAS environment variables, not `app/.env`** (D-037). EAS cloud builds never receive the gitignored `.env`; `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set as plaintext EAS variables for development, preview and production. |
| Enforcement | `npm run check:env`, wired to `eas-build-post-install`, fails the build on a missing value, an unfilled `<...>` template, a `sb_secret_` key, a legacy anon JWT, or a malformed URL |

Build history for context: `a2e8fccc` (halted on three defects), `f815ea27` (unusable — "Backend
is not configured", the failure that produced D-037), `9f5be4d2` (config loaded, never exercised),
`e1a3bdd4` (current, and the build the successful run above was done on).

---

## 8. What a fresh session would get wrong from the repo alone

1. **`syncQueue.ts`'s header comment says the queue "drains on the next foreground". It does
   not.** No `AppState` listener exists. Believe §3 of this file, not that comment.
2. **`SignInScreen.tsx` comments and `tests/otp-format.test.ts` still say the project issues 8
   digits.** It issues 6 as of 15:58 IST today. The code is unaffected — 6 is inside the accepted
   6–10 range and every test still passes — but the prose is now wrong, and one test is *named*
   "accepts the 8-digit code this project issues". Left unfixed deliberately: this session was
   closed out under an explicit instruction not to start new work.
3. **`reports/R-003-backend.md` §9 says all four tables hold zero rows and no run has succeeded.**
   That was true at 15:11 and false by 16:00. R-003 has not been revised; §4 above is the current
   state.
4. **T-003's status block in `tasks/T-003-backend.md` predates the device run** and lists AC-3.1,
   3.5, 3.6, 3.7 as NOT VERIFIED. Four of those now have results.
5. **The auth email templates in `backend/templates/` have never been pasted into the dashboard.**
   They are files in a repo, not live configuration. Sign-in currently works with Supabase's
   default template.
6. **`npx expo lint` exits 0 without linting anything.** The real gate is `npm run lint`
   (`eslint .`). An earlier report of mine claimed "lint clean" on the strength of the former;
   that was a false gate and is corrected in R-002 §11.
7. ~~The project ref appears in a public repo.~~ **RULED ACCEPTABLE by the checker,
   2026-09-08**, recorded under D-041. It is not a credential; it is in the URL every install
   calls. Security rests on RLS (8/8) and on the anon key being public by design (AC-3.9). No
   action, and **do not rewrite history over it**.
8. **No health claim appears in any string**, and the D-027 "what leaves this phone" paragraph is
   on both the sign-in and settings screens. Keep it that way when editing copy.
9. **Local SQLite is the source of truth for display.** The server is a mirror. A failed sync
   must never change what the member sees.

---

## 9. Housekeeping done at close

`.vitest/json/output.json` — a 48 KB test-reporter artifact — was committed by accident in
`dc8e473` by a `git add -A`. It has been removed from tracking and `.vitest/` added to
`.gitignore`. It contains no secrets, only test names and timings, so it was removed going
forward rather than purged from history; contrast D-030, where HANDOFF genuinely warranted a
history rewrite.

---

## 10. Next session should start by

1. Reproducing DEF-003-01 on device and finding why the tap produces no frame change.
2. Implementing the missing half of deliverable 4 — a real `AppState` foreground listener that
   drains the queue — then re-running AC-3.6 properly.
3. AC-3.5: intercept a live session and confirm no timestamp inside the sleep window, no HR and
   no RHR value leaves the phone.
4. Pasting both email templates into the dashboard.
5. Verifying `zenoho.com` in Resend before anyone but the founder is invited.
6. Correcting the stale 8-digit prose in §8 item 2.

Per D-036, before touching Supabase, EAS, GitHub or Resend: print which account and org the CLI
is authenticated as, and stop for confirmation.
