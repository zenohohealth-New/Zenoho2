# R-001 · Foundation: repo, health-store bridge, on-device derivation

Task: tasks/T-001-foundation.md · Maker: Claude Code · Status set to IN_REVIEW
Spec sections read: §4, §5, §7, §9, §11, §12, §13 · Decisions: D-003, D-009, D-010, D-011, D-012, D-013, D-014
Date: 2026-09-07 · Revised 2026-09-07 after checker review (code PASS, device evidence BLOCKED)

> **Headline for the checker:** deliverables 1–6 are complete and green in CI-equivalent
> local runs. **Deliverable "device evidence" is NOT met.** No APK was ever installed on a
> phone, because this machine has no JDK, no Android SDK and no `adb`, and EAS is not
> logged in. AC-1 and the Android half of AC-10 are therefore **unproven**, not passed.
> Section 9 and "Blocked on founder action" say exactly what is needed to close that.
>
> **Revision note:** checker rulings D-016 to D-019 are implemented; `expo-build-properties`
> and `expo lint` are in. Section 9 is deliberately untouched — it stays as it is until the
> phone screenshot exists. Section 10 records what happened with the hook removal.
>
> **Third revision:** two device runs have now happened; §9 carries the device, its OS and
> a run log. Both original T-001 open items are closed by real observation. The Android
> acceptance gate is still not met — see §9 and §12.
>
> **Second revision:** D-015 recorded, D-020 (expo-sqlite) implemented, D-019 clarified.
> **Correction:** the previous revision reported "lint clean" on the strength of
> `npx expo lint`, which exits 0 without linting anything in this project. The gate was a
> no-op and the claim was wrong. `npm run lint` now calls `eslint .` directly, which does
> run — and immediately found a real bug in `App.tsx` that the no-op had hidden. Fixed; see
> §3 and §11.

---

## 1. What changed

**Repo.** Confirmed `C:\Zenoho2` was not inside any existing git repository
(`git rev-parse --show-toplevel` → "not a git repository"), then `git init` on branch
`main`, an Expo/React-Native `.gitignore`, and a first commit `chore: repo seed`. Remote
`origin` added and `main` pushed. Repo-local identity set to Shashank Arya
<zenohohealth@gmail.com>; the seed commit's author was amended to match.

**Decisions.** D-011 status → DECIDED (confirmed by founder 2026-09-07). D-013
(Windows/Android-first/iOS deferred) and D-014 (S26 Ultra + Vívoactive 5) appended.
Two consistency edits beyond the literal instruction, both flagged to the founder at the
time: the D-011 *heading* still read "(PROVISIONAL — founder may override)", and the spec
header still said "Governing decisions: D-001 … D-012".

**Spec.** AC-10 rewritten: it required an iOS physical-device result, which D-013 makes
unobtainable. It now requires the Android half and marks the iOS half DEFERRED.

**App.** Expo SDK 57 / React Native 0.86 project in `app/`, TypeScript, custom dev client.
Health Connect and HealthKit config plugins wired with read-only scopes.

**Derivation.** `app/src/derive/` implements spec §5 as pure TypeScript — no platform
imports, no ambient clock, no I/O. Every input, including `computedAt`, is injected, so the
whole module is deterministic and testable off-device.

**Privacy boundary.** `app/src/net/payload.ts` builds the server row as an explicit
whitelist of the seven columns §7 permits (a new field on `DerivedNight` cannot leak by
accident). `app/src/net/guard.ts` re-checks any outgoing body at runtime and throws on a
forbidden key, an ISO instant, or an epoch-millisecond integer.

**Checker rulings (2026-09-07).** D-016: the timezone-jump branch produces
`state = TRAVEL` — my implementation was already correct, and spec §5 was corrected to match
§7/§8/AC-2. D-017: `HealthStore` gained `readRhrHistory(days, tzOffsetMin)`, implemented on
both bridges against `RestingHeartRateRecord` / `HKQuantityTypeIdentifierRestingHeartRate`,
with an on-device 10th-percentile fallback persisted locally. D-018: recorded, implementation
deferred with iOS. D-019: wear presence now rejects HR whose own source is blocked, and
`HrSample` carries `recordingMethod` so a hand-typed heart rate cannot satisfy L2.

**Build and lint.** `expo-build-properties` pins `android.minSdkVersion=28` (spec §12) —
verified in the generated `android/gradle.properties`, which the previous dead `app.json` key
never produced. `expo lint` is configured; the four warnings it first reported are fixed, two
by merging duplicate type imports and two with a targeted disable on the deliberate lazy
`require()` in the platform dispatcher.

**Second round of rulings (2026-09-07).** D-015 recorded as given (no beta label; the
founder's own 7-night mini-cycle gates any invite). D-020: `expo-sqlite` is now the single
on-device store, holding `rhr_nights` today and the local `daily_states` cache from T-002;
`SqliteRhrHistoryStore` replaced the in-memory one in the production path, and the in-memory
implementation is retained for tests only. D-019's text now says explicitly that only BLOCKED
sources are excluded and that UNKNOWN sources count while the night still carries UNVERIFIED.

**Device harness.** `App.tsx` is a diagnostic screen, not product UI. It reports health-store
availability, permission outcome, background-read grant, counts read, **the real
`dataOrigin` strings observed on the device** (a T-001 open item), eligibility, RHR history
depth and whether the D-017 fallback was used, and the derived night. It is the instrument that will close section 9 once an APK is installed.

---

## 2. Files changed

**Created — app**
```
app/                          Expo SDK 57 scaffold (blank-typescript), template
                              CLAUDE.md / AGENTS.md / .claude / LICENSE removed
app/app.json                  names, scheme, bundle id/package, read-only Health strings,
                              Health Connect read permissions incl. background + history
app/eas.json                  development / preview / production build profiles
app/vitest.config.mts         root = repo root so tests/ can import app/src
app/tsconfig.json             strict, resolveJsonModule, includes ../tests, vitest path map
app/App.tsx                   T-001 device harness screen
app/src/derive/types.ts       SleepSession, HrSample, Commitment, DerivedNight
app/src/derive/time.ts        local-time and circular-minute helpers (dependency-free)
app/src/derive/session.ts     §4 main-session selection
app/src/derive/wear.ts        §4 wear presence (30-min buckets, 70% threshold)
app/src/derive/rhr.ts         D-009 L3 coherence
app/src/derive/index.ts       §5 state machine, applyRevision, streak, device prompt
app/src/eligibility/source-allowlist.v1.json   versioned §9 allow-list
app/src/eligibility/index.ts  classifySource, checkEligibility (AC-1), rejection copy
app/src/health/types.ts       the one HealthStore interface (deliverable 2)
app/src/health/window.ts      48h read window
app/src/health/healthConnect.android.ts   Health Connect bridge (read-only)
app/src/health/healthKit.ios.ts           HealthKit bridge (read-only, NEVER RUN)
app/src/health/index.ts       lazy platform dispatch + test seam
app/src/net/payload.ts        §7 field whitelist
app/src/net/guard.ts          raw-health leak guard + guardedFetch
app/src/storage/purge.ts      45-day local retention
app/src/storage/db.ts         D-020 the single expo-sqlite database + migrations
app/src/storage/rhrStore.ts   D-017 interface, merge policy, retention, test double
app/src/storage/sqliteRhrStore.ts  D-020 the durable RHR store (kept apart so tests stay pure)
app/src/health/rhrHistory.ts  D-017 store-first, percentile-fallback assembly
app/eslint.config.js          eslint-config-expo flat + a D-020 no-restricted-imports rule
```

**Created — tests**
```
tests/fixtures/derivation-cases.json   21 cases (9 AC-2, 12 beyond)
tests/helpers/fixtures.ts              expands the compact HR/RHR generators
tests/derive.test.ts                   AC-2 + §5 helper units
tests/eligibility.test.ts              AC-1 + §9 classification
tests/netguard.test.ts                 AC-9
tests/purge.test.ts                    45-day retention
tests/rhr-history.test.ts              D-017 fallback, merge and load paths
```

**Modified — root**
```
.gitignore                    new (Expo/RN)
CLAUDE.md                     closing block appended verbatim
decisions/DECISIONS.md        D-011 → DECIDED; D-013, D-014 added
spec/ZENOHO2-V1-SPEC.md       header D-001…D-014; AC-10 rewritten
tasks/T-001-foundation.md     goal, deliverable 7, verification → Android-first
reports/R-001-foundation.md   this file
```

**Commits** (small, conventional, one topic each)
```
chore: repo seed
docs: confirm D-011, add D-013/D-014, Android-first scope, closing block
feat(app): scaffold Expo dev-client app with Health Connect + HealthKit bindings
feat(derive): pure-TS daily state derivation, eligibility and network guard
feat(app): T-001 device harness screen and EAS build profiles
docs: R-001 implementation report; T-001 IN_REVIEW
fix(derive): rulings D-016-D-019; build props; lint
fix: D-015 recorded, D-020 sqlite store, D-019 clarified
fix(health): add READ_RESTING_HEART_RATE, isolate reads, degrade RHR failures
chore(app): link EAS project (owner zenoho-expo-new)
fix(health): scope HR read to the sleep session and paginate; allow-list v2
```

---

## 3. Tests run

| Gate | Command | Result |
|---|---|---|
| Unit + fixtures | `npm test` (vitest) | **82/82 passed**, 6 files |
| Typecheck | `npx tsc --noEmit` | **clean**, 0 errors — covers `app/src` (both platform bridges) and `tests/` |
| Native config | `npx expo prebuild --platform android --clean` | **succeeded**; manifest and `minSdkVersion=28` inspected |
| Android build | `eas build --profile development --platform android` | **SUCCEEDED** (`0d617dfd`), installed and run on the S26 Ultra |
| iOS build | — | **SKIPPED** by D-013 |
| RLS denial (AC-3) | — | **SKIPPED**; no backend exists in T-001 by instruction |
| Lint | `npm run lint` (`eslint .`) | **clean**, 0 errors 0 warnings — see the correction below |

Generated `AndroidManifest.xml` contained exactly the four intended health permissions and
**no** `permission.health.WRITE_*` entry, plus the Health Connect rationale intent filter
and the Android-14+ `ViewPermissionUsageActivity` alias:

```
android.permission.health.READ_SLEEP
android.permission.health.READ_HEART_RATE
android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND
android.permission.health.READ_HEALTH_DATA_HISTORY
```

**Correction — the lint gate was previously a no-op.** The last revision of this report
claimed "lint clean" from `npx expo lint`. That command exits 0 in this project while linting
nothing: running `npx eslint App.tsx` directly on the same tree reported 2 errors and 1
warning. The claim was therefore unfounded, not merely optimistic. `package.json`'s `lint`
script now runs `eslint .`, and the gate above is that command.

Two things came out of fixing it. First, the D-020 lint rule below is verified by deliberately
introducing a violating import and confirming the gate fails (exit 1, `no-restricted-imports`),
then confirming it passes once reverted — a rule that is never seen to fail is not a gate.
Second, the working gate immediately caught a genuine bug the no-op had hidden: `App.tsx`
called `setState` synchronously inside a mount effect (`react-hooks/set-state-in-effect`),
which causes cascading renders. Fixed properly rather than suppressed — the probe was split
into a `probeOnce()` that returns its result and touches no state, so the effect only sets
state after an await, and the button's own reset path is separate.

After adding `expo-build-properties`, `android/gradle.properties` contains
`android.minSdkVersion=28`, satisfying spec §12. Health Connect's `RestingHeartRate` read
permission (D-017) is requested at runtime alongside sleep and heart rate; it is not a
separate manifest entry.

The generated `android/` directory was deleted afterwards (Expo CNG; it is gitignored).

### Fixture cases

AC-2 asks for eight behaviours; "late sync" splits into a before/after pair, so nine.

| # | Case | Expected |
|---|---|---|
| 1 | `AC2-01-kept-within-tolerance` | KEPT / OK / dev 10 |
| 2 | `AC2-02-missed-by-bed` | MISSED / OK / dev 65 |
| 3 | `AC2-03-missed-by-wake` | MISSED / OK / dev 90 |
| 4 | `AC2-04-no-hr-is-no-data` | NO_DATA / NO_WEAR |
| 5 | `AC2-05-manual-entry-is-no-data` | NO_DATA / NO_SOURCE |
| 6 | `AC2-06-two-sessions-longest-wins` | KEPT / OK / dev 10 |
| 7 | `AC2-07-timezone-jump-is-travel` | TRAVEL / TRAVEL |
| 8 | `AC2-08a-late-sync-before-1400-revises` | revised, revisionCount 1 |
| 9 | `AC2-08b-late-sync-after-1400-does-not-revise` | unchanged, frozen |

**Twelve cases beyond AC-2** (the task asked for at least five):

| # | Case | Why it earns its place |
|---|---|---|
| 10 | `EXTRA-09-wear-presence-exactly-at-threshold` | 7 of 10 buckets = exactly 0.70. Pins the threshold as inclusive; an off-by-one here silently converts real nights to NO_DATA. |
| 11 | `EXTRA-10-wear-presence-just-below-threshold` | 6 of 10 = 0.60. The other side of the same boundary. |
| 12 | `EXTRA-11-midnight-wrap-bed-target` | Bed target 00:15, asleep 23:50 → a 25-min miss, not 1415. The single most likely arithmetic bug in the whole module. |
| 13 | `EXTRA-12-unknown-origin-with-hr-is-unverified` | §9's deliberate soft-fail: a new brand must not be silently excluded. |
| 14 | `EXTRA-13-phone-os-origin-is-blocked` | D-003's hard edge — phone-written sleep must never count. |
| 15 | `EXTRA-14-rhr-drift-flags-unverified` | Exercises D-009 L3 end to end (20 bpm drift over a 30-night baseline). |
| 16 | `EXTRA-15-session-starting-before-1800-is-outside-window` | A 17:00 start is not a main sleep; guards the §4 window boundary. |
| 17 | `EXTRA-16-deviation-rounds-to-nearest-five` | 63 → 65, not 63 or 60. |
| 18 | `EXTRA-17-deviation-exactly-at-tolerance-is-kept` | §5 says ≤, so ±30 at tolerance 30 is KEPT, not MISSED. |
| 19 | `EXTRA-18-second-revision-is-refused` | §5 allows the state to be revised *once*. |
| 20 | `EXTRA-19-hr-from-blocked-source-cannot-prove-wear` | D-019: Garmin sleep but phone-written HR → NO_WEAR. Closes the hole where a phone manufactures the proof that a watch was worn. |
| 21 | `EXTRA-20-manually-entered-hr-cannot-prove-wear` | D-019: Garmin sleep but hand-typed HR → NO_WEAR. |

AC-9 is tested by running every fixture night through the real pipeline
(derive → `toServerRow` → `guardedFetch`) with `fetch` stubbed, then asserting the captured
body contains none of that case's session timestamps or HR sample times, in either epoch-ms
or ISO form. The guard is also attacked directly with deliberately poisoned bodies, so a
guard that silently stopped working fails the suite rather than passing it.

---

## 4. Tests passed / failed

**Passed: 69. Failed: 0.** No test is skipped, `.only`'d, or marked todo.

Honest caveat the checker should weigh: I wrote both the fixtures and the implementation.
The suite proves the code matches *my reading* of §5 — it cannot prove that reading is what
the founder meant, and it cannot prove anything about real Health Connect data. See §5 and §6.

---

## 5. Assumptions

Each of these was a genuine fork in the spec. None is invented policy; all are readings.

1. ~~**TRAVEL is a state, not an integrity flag on NO_DATA.**~~ **RESOLVED — D-016.**
   The checker confirmed the reading; spec §5 has been corrected to match §7/§8/AC-2. No code
   change was needed.
2. **Night date = the calendar day the user wakes** (§4), so the §4 start window runs
   18:00 on N−1 to 12:00 on N.
3. **A trailing partial wear bucket counts as a full bucket.** A 70-minute session is 3
   buckets, not 2.33. A 20-minute tail with no HR is still 20 unproven minutes.
4. ~~**Wear presence accepts HR from any source.**~~ **SUPERSEDED — D-019.** HR now counts
   only if its own source passes §9 classification; `HrSample` carries `recordingMethod` so
   manual entries are rejected too. Any acceptable wearable still counts, not only the app
   that wrote the sleep session.
5. **"Revised once" means at most one revision, ever** — tracked by `revisionCount`, and
   independently frozen at 14:00 local.
6. **RHR baseline windows exclude the night being judged**: baseline = median of the last
   30 nights strictly before it (≥14 required), recent = median of the last 7.
7. **`deviation_min` rounds half away from zero** to the nearest 5 (63 → 65).
8. **An unknown origin sets integrity = UNVERIFIED even when RHR is fine**, since §9's
   soft-fail and L3 both land on the same flag.
8b. ~~D-019 excludes only BLOCKED sources from wear presence.~~ **CONFIRMED by the checker
   2026-09-07** and written into D-019's text: only phone-OS and manual sources are excluded;
   UNKNOWN sources count, and the night still carries integrity UNVERIFIED.
9. **Longest-session ties break toward the earlier start**, purely for determinism.
10. **Ineligible sources are filtered before "longest" is applied**, so a long manual entry
    cannot shadow a shorter real wearable session. Unit-tested.
11. **The §9 allow-list identifier strings are my best reconstruction, not observed fact.**
    §9 names brands; it does not give package ids. Every entry is marked `verified: false`.
12. **The D-017 fallback uses a nearest-rank 10th percentile** and returns null below 10
    samples in the window, rather than emitting a figure a thin night cannot support — a bad
    RHR value feeds a false integrity flag.
13. **One RHR value per night**, keyed on local date; where a store holds several, the last
    is kept.

---

## 6. Unresolved issues

1. ~~§5 vs §7/§8/AC-2 on TRAVEL~~ — **CLOSED by D-016.**
2. ~~iOS `com.apple.health` admits phone-only sleep~~ — **RULED by D-018** (eligibility keys
   on the source device model containing "Watch"). Spec §9 and the allow-list now say so.
   **Still open as work:** the rule is not implemented, by instruction, until iOS resumes.
   `classifySource` has no device-model parameter yet, so this is a signature change when it
   lands, not a data change.
3. ~~No RHR source is wired~~ — **CLOSED by D-017 and D-020.** `expo-sqlite` is the store;
   `SqliteRhrHistoryStore` is in the production path, the in-memory double is test-only and a
   lint rule now blocks it from being imported into app source. The schema carries a
   `user_version` migration ladder so `daily_states` can be added in T-002 without a rewrite.
   **Caveat the checker should weigh:** none of the SQLite code has executed. It cannot run in
   the Node test suite (native module) and nothing has run on a phone, so the migration, the
   upsert and the retention `DELETE` are unexercised. The retention *policy* is tested through
   the pure `mergeRhrNight`, and the SQL is written to match it, but "matches by inspection"
   is not "matches". First device run should confirm the RHR row count grows and caps at 45.
4. ~~`minSdkVersion` is not pinned to 28~~ — **CLOSED.** `expo-build-properties` approved and
   added; `android.minSdkVersion=28` verified in the generated project.
5. ~~No linter~~ — **CLOSED.** `expo lint` approved and configured; clean.
6. **Health Connect background-read availability on the S26 Ultra is unknown** — the original
   T-001 open item, still open, because nothing has run on the phone. `READ_HEALTH_DATA_IN_BACKGROUND`
   is requested and present in the manifest, but Android 15+ gates it and the harness has not
   reported back.
7. **Real `dataOrigin` strings are still unobserved** — the second original open item. The
   harness prints them; nobody has run it.
8. **`expo lint` is not usable as a gate in this project** — it exits 0 without linting.
   Root cause not chased, since `eslint .` works and is what the scripts now use. Worth knowing
   if anyone reaches for `npx expo lint` expecting it to check anything.
9. **`npm audit` reports 11 moderate advisories**, all in transitive dependencies of the Expo
   toolchain, none in a direct dependency. Not addressed: forcing resolutions on an SDK 57
   tree is more likely to break the build than to help.
10. **Play Console health declaration is not filed.** Spec §12 wants it in week 1 (approval up
   to 7 days plus 5–7 business days whitelist propagation). Not a T-001 deliverable, but it is
   the longest lead time on the board and starts nothing until someone files it.
11. **The failing hook could not be removed as instructed** — see §10. Checker has accepted
    this; the founder will disable the Pixeltable plugin.

---

## 7. Risks

- **The derivation is unvalidated against real data.** Fixtures I wrote, checked against code
  I wrote, is a closed loop. The first night of real Garmin data is the actual test, and the
  most likely surprises are the shape of Garmin's sleep sessions (one session or several
  stage-split records?) and how densely Garmin Connect writes HR into Health Connect.
  Sparse HR would fail the 70% wear check and turn genuine nights into NO_DATA.
- **Allow-list strings may be wrong.** If Garmin's real package is not
  `com.garmin.android.apps.connectmobile`, the founder's own nights classify as UNKNOWN →
  integrity UNVERIFIED. It degrades safely (never to a false KEPT) but would look broken.
  The harness exists to close this in one run.
- **The 70% wear threshold and the 12 bpm L3 threshold are untested numbers** carried from the
  spec, which itself marks them PROVISIONAL. They will need retuning against real data.
- **Expo 57 / RN 0.86 with these two health libraries is an unproven combination on device.**
  It typechecks and prebuilds; that is not the same as running.
- **Android-only for the foreseeable future** (D-013). D-003's Tier 1 list is materially
  stronger on Android, so this is survivable, but the iOS bridge is accumulating unverified
  code with no feedback loop.
- **Unexecuted code is accumulating.** The SQLite layer joins the iOS bridge in the category
  of code that compiles, typechecks and reads correctly but has never run. That category grows
  with every task until an APK is installed, and each addition makes the first device run more
  likely to surface several problems at once rather than one.
- **A gate I reported as passing was not running.** Corrected here, but the lesson generalises:
  every gate in §3 should be provably able to fail. The D-020 lint rule now is; the others earn
  that credibility only by having failed at some point during development, which the test suite
  and typecheck both have.
- **Schedule risk:** the Play health declaration (§6 item 10) is the critical path to any real
  beta, and its clock has not started.

---

## 8. Recommended next step

**Before T-002, close the device loop.** In order:

1. ~~Founder answers the approval questions~~ — done. D-015 to D-020 are all recorded and
   implemented, except D-018, which is deferred with iOS by ruling. Nothing is waiting on a
   decision any more.
2. Founder logs into EAS; I run the development APK build and hand over the install steps.
3. Founder installs it on the S26 Ultra, grants Health Connect permissions, and screenshots
   the harness. That single screenshot closes AC-1, the Android half of AC-10, and both
   original T-001 open items (background-read availability, real `dataOrigin` strings).
4. I fold the observed origin strings into `source-allowlist.v2.json` **with evidence**, and
   re-run the suite against a fixture built from the real night.
5. File the Play Console health declaration the same week, in parallel with all of the above.

Only then T-002 (backend, schema, RLS), where AC-3's denial test finally has something to
deny.

---

## 9. Devices used (physical, with OS version)

**Device under test (D-014)**

| | |
|---|---|
| Phone | **Samsung Galaxy S26 Ultra** |
| OS | **Android 16, One UI 8.5**, build `BP4A.251205.006`, security patch 2026-07-05 |
| Wearable | **Garmin Vívoactive 5** via Garmin Connect → Health Connect |
| iOS | none — **DEFERRED** (D-013). No result will be entered here that did not come off real hardware. |

**Run log**

| Run | Build | Outcome |
|---|---|---|
| 1 | first dev APK | **FAILED.** `SecurityException: Caller requires android.permission.health.READ_RESTING_HEART_RATE`. The manifest lacked the permission, and the unguarded read took the whole probe down: every row showed "—". |
| 2 | `0d617dfd` | **PARTIAL.** Reads succeeded — 2 sleep sessions, 1000 HR samples, origin `com.garmin.android.apps.connectmobile`, eligibility ELIGIBLE, background read granted, 6 nights of RHR read directly. But wear ratio was **0%**, so the night derived as NO_DATA / NO_WEAR. Diagnosed as the Health Connect 1000-record page cap: the read returned the oldest samples in the 36-hour window, none of which overlapped the session. Fixed and regression-tested; not yet re-run. |
| 3 | — | **NOT YET RUN.** JS-only change; reloads over the dev server. |

**What run 2 did establish, as fact rather than inference**

- Health Connect is reachable from the app on this device, and the permission flow works.
- Background read is **granted and available on Android 16 / One UI 8.5** — closing the first
  of T-001's two original open items.
- The real Android dataOrigin for Garmin is `com.garmin.android.apps.connectmobile` — closing
  the second. Allow-list v2 marks it `verified: true` with this run as evidence. Every other
  identifier in that file remains unverified.
- Garmin **does** write `RestingHeartRateRecord`: 6 nights were read directly and the D-017
  fallback was not used. The fallback is therefore unnecessary for Garmin, and is retained
  only for brands that write no resting heart rate.

**AC-1 and the AC-10 Android half remain NOT MET.** A run that derives NO_DATA because of a
paging bug is not a passing run, and I am not recording it as one. The gate is a run that
produces a real KEPT or MISSED from a genuine night, with a non-zero wear ratio. That needs
run 3.

---

## 10. Hook removal (checker item 7) — NOT DONE, and why

The instruction was to remove the failing `PostToolUse` hook from the user-level Claude
settings. **It is not there, so there was nothing to remove.** I did not want to fabricate an
edit that would look like compliance, so here is the actual finding.

- `~/.claude/settings.json` contains five keys — `autoUpdatesChannel`, `skipWorkflowUsageWarning`,
  `theme`, `inputNeededNotifEnabled`, `agentPushNotifEnabled`. No `hooks` block.
  There is no `~/.claude/settings.local.json`, and `~/.claude.json` has no hook configuration.
- The hook is contributed by the **Pixeltable plugin v2.6.0**, bundled by the Claude desktop
  app under `…/local-agent-mode-sessions/<session>/rpm/plugin_01HuktqZUKz58qgxUm1mfuh6/`.
  Its `hooks/hooks.json` registers `validate_antipatterns.py` on `PostToolUse` for
  `Write|Edit|MultiEdit`, and `session_orientation.py` on `SessionStart`.
- Correction to what I reported earlier: **the script is not missing.** It exists at that path
  and is readable. `python3` resolves to the Windows Store shim at
  `AppData/Local/Microsoft/WindowsApps/python3` (Python 3.14.4), and that invocation is what
  fails to open the file — so this is a Windows path/launcher problem in the plugin's hook
  command, not a broken install and not anything Zenoho2 did.
- **It is harmless.** It runs after a write has already succeeded and only prints an error; no
  file in this repo was affected, and every gate above passed with it firing.

**What will actually remove it:** disable or uninstall the Pixeltable plugin in the Claude
desktop app's plugin settings. It has nothing to do with this project. I deliberately did not
reach for a project-level `disableAllHooks` in `C:\Zenoho2\.claude\settings.json` — that
would silence *all* hooks in Zenoho2, including ones you may want later, to suppress one
unrelated plugin's error message. Say the word if you would rather have that anyway.

---

## 11. Correction to the previous revision

The last version of this report listed, under §3:

> | Lint | `npx expo lint` | **clean**, 0 errors 0 warnings |

That was wrong, and it is the kind of wrong worth naming rather than quietly editing. `npx expo
lint` exits 0 in this project without linting anything, so the row recorded the absence of
output as the absence of problems. Running `npx eslint App.tsx` on the identical tree reported
2 errors and 1 warning.

What it was hiding: `App.tsx` called `setState` synchronously inside its mount effect
(`react-hooks/set-state-in-effect`), which triggers cascading renders. That has been fixed by
splitting the probe into a `probeOnce()` that returns its result rather than writing state, so
the effect only sets state after an await; the button keeps its own reset path, where a
synchronous reset is correct.

Two process changes came out of it. `package.json`'s `lint` script now runs `eslint .` rather
than delegating to a command that silently does nothing. And the new D-020 lint rule was
verified by watching it fail: a deliberately violating import made the gate exit 1 with
`no-restricted-imports`, and reverting it returned the gate to green. I have not applied that
standard retroactively to the test and typecheck gates, though both have failed and been fixed
during this task, which is the same evidence by a different route.

---

## 12. Device run 2 — what broke and what it cost

Run 2 read 1000 heart-rate samples and still reported a 0% wear ratio. Exactly 1000 was the
tell: Health Connect caps a single read at 1000 records and returns them oldest-first, so an
unpaginated read of the 36-hour window returned samples from the day *before* the night. None
overlapped the sleep session, so wear presence was legitimately 0 — the derivation was right
about the data it was given, and the data was wrong.

Two fixes, both in `healthConnectMapping.ts`:

- **Scope**: heart rate is now read for the span of the sessions actually returned, not the
  whole window. Wear presence only ever looks inside a session, so the wider read bought
  nothing and cost the cap. It falls back to the full window when there are no sessions, so
  eligibility still has heart rate to inspect.
- **Paginate**: `readAllPages` follows `pageToken` for sleep, heart rate and resting heart
  rate, with a 50-page ceiling so a misbehaving provider cannot spin forever.

`tests/read-isolation.test.ts` gained four cases, including one where heart rate exists in the
window but entirely outside the session — the honest negative, proving the scoping does not
invent coverage. **These were verified against the pre-fix code**: reverting the scope-and-
paginate change makes three of them fail, and restoring it makes them pass. A regression test
that has never seen the bug is a guess.

**What this cost, and the pattern behind it.** Two device runs, two failures, both of them
integration facts that no amount of local reasoning would have surfaced: an undeclared manifest
permission, and a platform paging default. Both were invisible to a green test suite, a clean
typecheck and a successful prebuild. That is the concrete form of the risk this report has been
flagging since the first revision — unexecuted code accumulating faster than it can be
exercised. The SQLite layer (D-020) is still in that category and has never run; it is the most
likely candidate for the next surprise.

**Harness additions for run 3**: the screen now prints the local-time span of the heart-rate
samples read and of the selected main session. Had those two rows existed in run 2, the
mismatch would have been obvious on sight instead of requiring the sample count to be
recognised as a suspiciously round number.
