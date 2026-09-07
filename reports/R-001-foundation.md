# R-001 · Foundation: repo, health-store bridge, on-device derivation

Task: tasks/T-001-foundation.md · Maker: Claude Code · Status set to IN_REVIEW
Spec sections read: §4, §5, §7, §9, §11, §12, §13 · Decisions: D-003, D-009, D-010, D-011, D-012, D-013, D-014
Date: 2026-09-07

> **Headline for the checker:** deliverables 1–6 are complete and green in CI-equivalent
> local runs. **Deliverable "device evidence" is NOT met.** No APK was ever installed on a
> phone, because this machine has no JDK, no Android SDK and no `adb`, and EAS is not
> logged in. AC-1 and the Android half of AC-10 are therefore **unproven**, not passed.
> Section 9 and "Blocked on founder action" say exactly what is needed to close that.

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

**Device harness.** `App.tsx` is a diagnostic screen, not product UI. It reports health-store
availability, permission outcome, background-read grant, counts read, **the real
`dataOrigin` strings observed on the device** (a T-001 open item), eligibility, and the
derived night. It is the instrument that will close section 9 once an APK is installed.

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
```

**Created — tests**
```
tests/fixtures/derivation-cases.json   19 cases (9 AC-2, 10 beyond)
tests/helpers/fixtures.ts              expands the compact HR/RHR generators
tests/derive.test.ts                   AC-2 + §5 helper units
tests/eligibility.test.ts              AC-1 + §9 classification
tests/netguard.test.ts                 AC-9
tests/purge.test.ts                    45-day retention
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
```

---

## 3. Tests run

| Gate | Command | Result |
|---|---|---|
| Unit + fixtures | `npm test` (vitest) | **54/54 passed**, 4 files |
| Typecheck | `npx tsc --noEmit` | **clean**, 0 errors — covers `app/src` (both platform bridges) and `tests/` |
| Native config | `npx expo prebuild --platform android --clean` | **succeeded**; manifest inspected |
| Android build | — | **NOT RUN** (no JDK / Android SDK / adb; EAS not logged in) |
| iOS build | — | **SKIPPED** by D-013 |
| RLS denial (AC-3) | — | **SKIPPED**; no backend exists in T-001 by instruction |
| Lint | — | **NOT RUN**; no linter configured. `expo lint` would add ESLint + config as new dependencies, which the task's minimal-dependency rule says to justify first. Flagged in §6. |

Generated `AndroidManifest.xml` contained exactly the four intended health permissions and
**no** `permission.health.WRITE_*` entry, plus the Health Connect rationale intent filter
and the Android-14+ `ViewPermissionUsageActivity` alias:

```
android.permission.health.READ_SLEEP
android.permission.health.READ_HEART_RATE
android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND
android.permission.health.READ_HEALTH_DATA_HISTORY
```

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

**Ten cases beyond AC-2** (the task asked for at least five):

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

AC-9 is tested by running every fixture night through the real pipeline
(derive → `toServerRow` → `guardedFetch`) with `fetch` stubbed, then asserting the captured
body contains none of that case's session timestamps or HR sample times, in either epoch-ms
or ISO form. The guard is also attacked directly with deliberately poisoned bodies, so a
guard that silently stopped working fails the suite rather than passing it.

---

## 4. Tests passed / failed

**Passed: 54. Failed: 0.** No test is skipped, `.only`'d, or marked todo.

Honest caveat the checker should weigh: I wrote both the fixtures and the implementation.
The suite proves the code matches *my reading* of §5 — it cannot prove that reading is what
the founder meant, and it cannot prove anything about real Health Connect data. See §5 and §6.

---

## 5. Assumptions

Each of these was a genuine fork in the spec. None is invented policy; all are readings.

1. **TRAVEL is a state, not an integrity flag on NO_DATA.** §5's travel rule says
   "that night = NO_DATA, integrity = TRAVEL", but §7 lists TRAVEL among the states a
   witness sees, §8's enum has `state{…,TRAVEL}`, §5's own streak rule treats "NO_DATA/TRAVEL"
   as siblings, and AC-2 says "timezone jump → TRAVEL". Three places to one, so I implemented
   `state = TRAVEL, integrity = TRAVEL`. **This is the assumption most likely to be wrong.**
   It is one line to flip: `deriveDailyState`'s travel branch in `app/src/derive/index.ts`.
2. **Night date = the calendar day the user wakes** (§4), so the §4 start window runs
   18:00 on N−1 to 12:00 on N.
3. **A trailing partial wear bucket counts as a full bucket.** A 70-minute session is 3
   buckets, not 2.33. A 20-minute tail with no HR is still 20 unproven minutes.
4. **Wear presence accepts HR from any source**, not only the app that wrote the sleep
   session. Rationale: a Garmin watch writing sleep while a chest strap writes HR still
   proves the wrist was worn. `wearPresence()` takes an optional `sourceId` if the checker
   decides the stricter reading is correct.
5. **"Revised once" means at most one revision, ever** — tracked by `revisionCount`, and
   independently frozen at 14:00 local.
6. **RHR baseline windows exclude the night being judged**: baseline = median of the last
   30 nights strictly before it (≥14 required), recent = median of the last 7.
7. **`deviation_min` rounds half away from zero** to the nearest 5 (63 → 65).
8. **An unknown origin sets integrity = UNVERIFIED even when RHR is fine**, since §9's
   soft-fail and L3 both land on the same flag.
9. **Longest-session ties break toward the earlier start**, purely for determinism.
10. **Ineligible sources are filtered before "longest" is applied**, so a long manual entry
    cannot shadow a shorter real wearable session. Unit-tested.
11. **The §9 allow-list identifier strings are my best reconstruction, not observed fact.**
    §9 names brands; it does not give package ids. Every entry is marked `verified: false`.

---

## 6. Unresolved issues

1. **§5 vs §7/§8/AC-2 on TRAVEL** — see assumption 1. Needs a one-line ruling.
2. **iOS `com.apple.health` admits phone-only sleep.** §9 allow-lists that bundle for Apple
   Watch, but iPhone-only sleep is written under the same id, so the bundle alone cannot
   separate them — as written, §9 would let phone-only sleep through on iOS and contradict
   D-003. Recorded in the allow-list's `openQuestions`. Not urgent while iOS is deferred;
   blocking before iOS ships.
3. **No RHR source is wired.** L3 is implemented and tested, but `readNight`'s contract is
   fixed by T-001 deliverable 2 as `→ { sessions, hr }`, which has no room for resting-heart-rate
   history. Wiring it needs either a contract change or a second bridge method. I did not
   choose one, per "do not exceed the task's scope". **Decision needed.**
4. **`minSdkVersion` is not pinned to 28** (spec §12: Android 9 minimum). I set
   `android.minSdkVersion` in `app.json`, discovered prebuild ignores it — it is not an Expo
   config key — and removed it rather than leave dead config that reads as satisfied. Pinning
   it properly needs the `expo-build-properties` plugin, i.e. a new dependency. **Approval needed.**
5. **No linter.** `expo lint` would install ESLint and a config. One dependency, low risk,
   but it is a new dependency and the rule says justify first. **Approval needed.**
6. **Health Connect background-read availability on the S26 Ultra is unknown** — the original
   T-001 open item, still open, because nothing has run on the phone. `READ_HEALTH_DATA_IN_BACKGROUND`
   is requested and present in the manifest, but Android 15+ gates it and the harness has not
   reported back.
7. **Real `dataOrigin` strings are still unobserved** — the second original open item. The
   harness prints them; nobody has run it.
8. **`npm audit` reports 11 moderate advisories**, all in transitive dependencies of the Expo
   toolchain, none in a direct dependency. Not addressed: forcing resolutions on an SDK 57
   tree is more likely to break the build than to help.
9. **Play Console health declaration is not filed.** Spec §12 wants it in week 1 (approval up
   to 7 days plus 5–7 business days whitelist propagation). Not a T-001 deliverable, but it is
   the longest lead time on the board and starts nothing until someone files it.
10. **Environment, not project:** a `PostToolUse` hook in the local Claude config points at a
    missing file (`…/rpm/plugin_01HuktqZUKz58qgxUm1mfuh6/hooks/validate_antipatterns.py`) and
    errors on every file write. Harmless here, noisy.

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
- **Schedule risk:** the Play health declaration (§6 item 9) is the critical path to any real
  beta, and its clock has not started.

---

## 8. Recommended next step

**Before T-002, close the device loop.** In order:

1. Founder answers the three approval questions in §6 (items 3, 4, 5) and the TRAVEL ruling
   (item 1). All four are one-liners; all four are cheap now and expensive later.
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

| Platform | Device | Build installed | Health read fired | Background delivery |
|---|---|---|---|---|
| Android | **Samsung Galaxy S26 Ultra + Garmin Vívoactive 5** (D-014) | **NO** | **NO** | **NO** |
| iOS | none | **DEFERRED** (D-013) | **DEFERRED** | **DEFERRED** |

**No physical device was used in T-001. Nothing was run on the S26 Ultra. No result in this
report is derived from real device data, and none is inferred, estimated or simulated as if
it were.** The Android row is a blocker, not a pass.

Why: this Windows machine has no JDK, no Android SDK and no `adb`, so `expo run:android`
cannot produce an APK locally; and `eas-cli whoami` reports "Not logged in", so the cloud
build cannot start either. The OS version of the S26 Ultra is likewise unrecorded — it must
be read off the device, not assumed. Per D-013 no iOS device, Mac or Apple Developer account
exists, so the iOS row stays DEFERRED and will not be filled with anything but a real result.

---

## Blocked on founder action

Two things need you. Both are quick; the second is the one that matters.

**A · Log into EAS so I can build the APK.** Run this in your terminal and follow the
prompts (it asks for your Expo username/email and password):

```bash
npx eas-cli login
```

If you have no Expo account yet, create one at expo.dev first — it is free, and the
development-profile Android build fits in the free tier. Tell me when `npx eas-cli whoami`
prints your username, and I will start the build.

**B · Install the APK on the S26 Ultra and read the screen.** After A, I will run the build
and give you a download link. Then, on the phone:

1. Open the link in Chrome → **Download** → open the file → **Install**.
   If Android says "Install unknown apps", tap **Settings** → toggle **Allow from this
   source** → back → **Install**.
2. Open **Zenoho2**. It runs the probe automatically.
3. Health Connect shows a permission sheet. Tap **Allow all**, then **Allow**.
   If it separately asks about background access, tap **Allow all the time**.
4. If a screen says Health Connect is not set up, open the **Health Connect** app first,
   confirm **Garmin Connect** appears under *App permissions* with Sleep and Heart rate on,
   then reopen Zenoho2 and tap **Read again**.
5. **Screenshot the whole screen** and send it to me, and also tell me the phone's Android
   version (**Settings → About phone → Software information → Android version**).

That screenshot is the evidence section 9 is missing. Nothing else in T-001 is waiting on
anything.
