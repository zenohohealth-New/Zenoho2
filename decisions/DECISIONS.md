# ZENOHO2 — DECISION LOG

Format: ID · Date · Decision · Why · Evidence · Status (DECIDED / PROVISIONAL / OPEN)
Tags: FACT · EVIDENCE · INFERENCE · HYPOTHESIS · ASSUMPTION
Clean-room rule: nothing from any earlier Zenoho attempt is imported. This log is the only source of truth.

---

## D-000 · 2026-09-07 · Clean-room restart
Zenoho2 starts from first principles. Prior implementations, scoring systems, stacks and conclusions are untrusted historical material.
Status: DECIDED

## D-001 · 2026-09-07 · Thesis (restated, not validated)
Zenoho2 is a small-group accountability layer on top of objectively captured health behaviour. The unit of social proof is *consistency of a self-chosen, device-verified commitment*, never performance, never physiology.
Why: Strava's mechanics work because a run is a discrete, visible act. Sleep/HRV are continuous private states. The only way to make them social is to turn them into a kept/missed promise.
Evidence: NYC pilot (JMIR Formative Research 2026; n=123, RCT): generic wearable social features showed no effect on activity (P=.55). Commitment-contract review (PMC6591991): contracts alone ineffective; peer-witnessed contracts with ongoing contact performed best.
HYPOTHESIS (untested anywhere): an *app-mediated* named witness reproduces the human-witness effect. Beta wave 2 is the test.
Status: DECIDED as working thesis; core risk logged.

## D-002 · 2026-09-07 · Health Core: candidate behaviours
#1 Sleep-window regularity. #2 Movement consistency (v1.1, not v1).
HRV, RHR, respiratory rate, skin temp, sleep stages = context/integrity only; never compared across people; never shown to a witness.
Evidence: UK Biobank (Windred et al., Sleep 2024, n=60,977, accelerometer): higher sleep regularity → 20–48% lower all-cause mortality vs least-regular quintile; regularity outperformed duration. Replicated in Cribb et al., eLife 2023 (n=88,975).
Caveat (must appear in product copy): observational; cohort 62±8 yrs, UK, low diversity. Zenoho may say "associated with", never "will lower".
Status: DECIDED

## D-003 · 2026-09-07 · Hardware scope v1 = wearables only
Join requires a device whose companion app writes sleep sessions + heart rate to Apple HealthKit (iOS) or Health Connect (Android). No device = cannot join. No phone-only mode.
Tier 1 (desk-verified 2026-09-07): Apple Watch; Samsung Galaxy Watch (Android only); Fitbit/Pixel (Android; iOS weak); Garmin; Amazfit (Zepp); Xiaomi (Mi Fitness); Oura; WHOOP; Polar; Withings; Ultrahuman (iOS verified, Android unverified).
Excluded (phone-only or unsupported): boAt (Crest pushes steps only), Noise (claims sleep, users report steps only), Fire-Boltt (no documentation).
Why: phone-only sleep timing has ~36–38 min MAD (JMIR 2017) and no HR → no wear-time check → no integrity.
Risk accepted (stated once): cuts college/school groups roughly in half on day one; biases beta toward the already-fit.
v2 research: boAt/Noise BLE layer. Not a v1 blocker. Nudge cheap-watch owners to Mi Band (~₹3k) / Amazfit.
Status: DECIDED

## D-004 · 2026-09-07 · Pod structure = B (buddy-in-pod)
Pod = 3–8 people who already know each other. Each member has one named witness inside the pod. Pod sees aggregate only ("5 of 6 kept last night").
Symmetric visibility (A) and shared pod commitment (C) are switches on B, gated on retention data: A = per-member visibility toggle (v1.1); C = optional pod-level commitment (v1.2). Not modes. Not in v1.
Status: DECIDED

## D-005 · 2026-09-07 · What the witness sees
Three states per day: KEPT / MISSED / NO-DATA, plus current streak, plus one reaction affordance per day (nudge on miss, nod on kept). No times, no margins, no scores, no physiology. Margin ("missed by 40 min") is a member-unlockable switch, not default.
Guardrails: one reaction/day; no reaction counts displayed; no public feed.
Founder mandate: optimise for return visits with least burden. Rationale: witness needs something to *do*, not something to *judge*.
Status: DECIDED

## D-006 · 2026-09-07 · Cycle = 28 days, pod-synchronous
Whole pod runs one shared 28-day cycle. Commitment can be changed only at cycle boundary. Renewal = one tap; carries over by default. Weekly check-in touchpoint inside the cycle. Lifetime kept-count and cycles-completed persist across cycles; cycle streak resets on a miss, lifetime count does not.
ASSUMPTION: 28 days is inferred from contract literature (16+ week programmes worked; short ones didn't), not tested. Beta wave 1 to check week-3 drop-off.
Status: DECIDED (number PROVISIONAL)

## D-007 · 2026-09-07 · Comparison rule
Compare consistency only: cycle kept-rate, streaks, cycles completed, pod aggregate. Never bed/wake times, HR, sleep score or any physiology across people. Status = cycles completed, not "healthier than a friend".
Evidence: NYC pilot — social comparison was the sub-feature with signal; Oura's own guidance warns against criticising low scores.
Status: DECIDED

## D-008 · 2026-09-07 · Beta wave order
Wave 1 gym group (highest wearable density, most forgiving). Wave 2 college circle (real market). Wave 3 school friends (thinnest device base). Never all three at once.
Status: DECIDED

## D-009 · 2026-09-07 · Verification stack (integrity)
L1 Source: only sleep sessions whose source is a wearable companion app count; manual/phone-written sessions → NO-DATA.
L2 Wear-time: heart-rate samples must exist inside the claimed sleep window; absent → NO-DATA.
L3 Coherence (on-device): 7-day median RHR vs 30-day baseline; drift beyond threshold → integrity flag "UNVERIFIED" (state still computed, flag shown to member only, not witness, in v1).
L4 Longitudinal plausibility: v1.1.
L5 Social: witness "doubt" mark: v1.1.
Design goal is "not worth faking to people who know you", not "unfakeable".
Status: DECIDED (thresholds PROVISIONAL, see spec)

## D-010 · 2026-09-07 · Privacy architecture: derive on device, upload states
Raw sleep sessions and HR samples never leave the phone by default. The phone computes the daily state and integrity flag; the server stores only: state, source id, wear-presence boolean, deviation minutes (integer, hidden by default), integrity flag. RHR baselines stay on device.
Why: DPDP Act 2023 minimisation; App Store 5.1.3 / Play health-data policy; smaller breach surface; and it makes the witness-sees-states rule structural, not a UI choice.
Status: DECIDED

## D-011 · 2026-09-07 · Technical Core (confirmed by founder 2026-09-07)
Client: Expo (React Native) with a custom dev client; `@kingstinct/react-native-healthkit` (iOS) + `react-native-health-connect` v4 (Android, ships its own Expo plugin; `expo-health-connect` is deprecated).
Backend: one managed Postgres-with-auth service (Supabase-class BaaS), row-level security, edge/cron functions for weekly and cycle jobs, push via Expo Notifications. No custom server process in v1.
Why: HealthKit/Health Connect are on-device APIs → a mobile app is unavoidable; a cross-platform framework halves the surface; Expo has mature bindings for both health stores; a BaaS removes ops for a solo founder. Rejected: native ×2 (two codebases), Flutter (`health` plugin abstraction is thinner on background delivery), cloud wearable aggregators (no need — data is already on the phone; adds cost and a third-party health-data custodian).
Known constraints: Health Connect background reads need Android 15+ permission; else sync on foreground → design uses a morning push to trigger sync. Health Connect Play Console declaration: approval up to 7 days + 5–7 business days whitelist propagation → file in week 1. Default HC history = 30 days; request READ_HEALTH_DATA_HISTORY for baseline.
Status: DECIDED (confirmed by founder 2026-09-07)

## D-012 · 2026-09-07 · v1 scope = sleep commitment only
Movement commitment deferred to v1.1 to keep the maker/checker loop short. One behaviour, one witness, one cycle.
Status: DECIDED

## D-013 · 2026-09-07 · Development environment and platform order
Windows dev machine; Android-first; iOS via EAS cloud build + TestFlight once an Apple Developer account exists — iOS testing deferred.
Status note 2026-09-08 (see D-021): the founder has chosen an **Android-only launch**, and the
Apple Developer Program purchase is deferred until a first iPhone user is identified. "iOS
testing deferred" therefore now means deferred indefinitely rather than merely until hardware
is available: with no paid account there is no TestFlight and no ad-hoc build, so iOS cannot be
distributed to anyone at all. The iOS bridge continues to be kept compiling (it typechecks in
every run), which is cheap; it should not be extended further until the account exists and
there is a way to run it.
Status: DECIDED

## D-014 · 2026-09-07 · First test device
First test device: Samsung Galaxy S26 Ultra + Garmin Vívoactive 5, Garmin Connect → Health Connect, verified working by founder on 2026-09-07.
Status: DECIDED

## D-015 · 2026-09-07 · No beta label
v1 ships as a complete, invite-only release on the store. Gate before any invite: the founder
completes one 7-night mini-cycle alone (second account on a spare phone as witness).
Status: DECIDED

## D-016 · 2026-09-07 · Timezone jump produces the TRAVEL state, not NO_DATA
A night whose local UTC offset moved more than 3 h from the previous day is
`state = TRAVEL, integrity = TRAVEL`.
Why: spec §5's travel rule said "NO_DATA, integrity = TRAVEL", but §7 lists TRAVEL among the
states a witness sees, §8's enum is `state{KEPT,MISSED,NO_DATA,TRAVEL}`, §5's own streak rule
treats "NO_DATA/TRAVEL" as siblings, and AC-2 says "timezone jump → TRAVEL". Three places to
one. Spec §5 was the outlier and has been corrected to match.
Evidence: raised as R-001 assumption 1; ruled by checker 2026-09-07.
Status: DECIDED

## D-017 · 2026-09-07 · Resting heart rate has its own read path, with an on-device fallback
`HealthStore` gains `readRhrHistory(days, tzOffsetMin) → RhrNight[]`, reading Health Connect
`RestingHeartRateRecord` on Android and `HKQuantityTypeIdentifierRestingHeartRate` on iOS.
Where a store exposes no such record, the night's RHR is derived on device as the 10th
percentile of heart rate inside the sleep window and persisted locally.
Why: D-009 L3 needs a 30-night RHR baseline, but `readNight` returns only sessions plus HR,
and raw samples are purged at 45 days — so the baseline cannot be rebuilt from raw data.
D-010 is unchanged: RHR values and baselines never leave the device.
Resolved by D-020: `expo-sqlite` holds the derived history.
Evidence (R-001 device run 2, S26 Ultra, 2026-09-07): Garmin Connect DOES write
`RestingHeartRateRecord` to Health Connect — 6 nights were read directly and the fallback was
not used. So the fallback is unnecessary for Garmin specifically. It stays for brands that
write no resting heart rate, and because the 30-night L3 baseline has to survive gaps.
Status: DECIDED

## D-018 · 2026-09-07 · iOS eligibility keys on the source device model, not the bundle id
On iOS a sleep sample is eligible only if its HealthKit source device model contains "Watch".
iPhone-written or manual sleep = NO_SOURCE.
Why: spec §9 allow-lists `com.apple.health` for Apple Watch, but iPhone-only sleep is written
under the same bundle id, so the bundle alone cannot enforce D-003 and §9 as written would
have admitted phone-only sleep on iOS.
Implement when iOS work resumes (D-013), not before. Recorded now so the gap is not
rediscovered later.
Status: DECIDED (implementation deferred)

## D-019 · 2026-09-07 · Wear presence only counts heart rate from an acceptable source
An HR sample contributes to the D-009 L2 wear-time check only if its own source passes the
§9 classification. Phone-written and manually entered heart rate can never satisfy L2. Any
acceptable wearable source counts, not only the app that wrote the sleep session — a watch
writing sleep while a strap writes HR still proves the wrist was worn.
Why: without this, a phone could manufacture the heart rate that proves a watch was worn,
which defeats the point of L2.
Scope, confirmed by checker 2026-09-07: only BLOCKED sources are excluded — that is, phone-OS
writers and anything with recordingMethod MANUAL. UNKNOWN sources DO count towards wear
presence, and the night still carries integrity = UNVERIFIED. Excluding UNKNOWN as well would
contradict §9's rule that an unlisted brand is flagged rather than silently excluded.
Status: DECIDED

## D-020 · 2026-09-07 · Local persistence is expo-sqlite, one store for everything on device
`expo-sqlite` (official Expo module) is the single on-device store. It holds `rhr_nights` now
and, from T-002, the local cache of `daily_states`. Everything in it is covered by the 45-day
purge (T-001 constraint), except the RHR history, which keeps its own 45-night window because
D-009 L3 needs a 30-night baseline that outlives the raw-sample purge.
No in-memory store in production paths: the in-memory implementation is retained for tests only.
Why: D-017's fallback derives a nightly RHR that must survive an app restart, or an L3 baseline
can never accumulate. One store rather than several keeps the purge auditable in one place.
D-010 unchanged: nothing in this database is ever uploaded.
Status: DECIDED

## D-021 · 2026-09-07 · Store accounts — Play bought, Apple deferred
AMENDED 2026-09-08. As originally recorded this said "buy both store accounts". Only one was
bought.

**Google Play Console** (₹2,000 one-time): account created 08 Sep 2026; developer-identity
verification pending, expected to take a few days. Nothing that depends on the Play listing can
start until it clears — including the Health Connect declaration, whose own clock is ~7 days
approval plus 5–7 business days propagation on top. Sideloading is unaffected and still works
today (see the 2026-09-07 findings log).

**Apple Developer Program** (~₹9,000/yr): **DEFERRED**. The founder chose an Android-only
launch. Purchase when the first iPhone user is actually identified, not before — it is a
recurring cost against a platform with no user on it yet, and deferring it changes nothing
about the Android path.

Consequence, stated plainly so it is not rediscovered later: **iOS has no distribution route at
all until that account exists.** There is no sideload path on iOS; TestFlight and ad-hoc both
require the paid account. So the iOS bridge stays not merely untested but unshippable, and
D-018 (iOS eligibility by device model) stays unimplemented. See D-013.
Status: DECIDED (amended)

## D-022 · 2026-09-07 · Brand verification is evidence-gated
No wearable brand is marked verified until its source string AND a non-zero wear ratio are
observed on a real device. The T-001 harness ships hidden in-app as the verification tool.
Why: R-001 run 2 showed that observing the source string alone is not enough — Garmin's
dataOrigin was correct while the wear ratio was 0%, so the source looked verified while the
pipeline was broken. Both signals together are what distinguish "we can see this brand" from
"this brand actually works".
Status: DECIDED

## D-023 · 2026-09-07 · Every task ends on the phone
Every task from T-002 onward ends with a standalone preview APK on the founder's phone.
Dev mode is for building; preview is for living with it.
Why: R-001 needed three device runs to find two integration bugs that a green test suite, a
clean typecheck and a successful prebuild all missed. Shipping a preview build per task keeps
that discovery loop one task long instead of several.
Status: DECIDED

## D-024 · 2026-09-07 · Task order changed — local engine before backend
T-002 is the local nightly engine (no backend); the backend moves to T-003.
Why: the local engine is unblocked tonight, it exercises the D-020 SQLite path that R-001
flagged as never-executed, and it starts accumulating nights immediately — the D-009 L3
baseline needs 14 before it can say anything at all.
Status: DECIDED

## D-025 · 2026-09-07 · New users start empty; first 14 nights are baseline-building
A new user has no history: Health Connect holds recent data only, and it holds nothing at all
from before they started wearing the device. Observed on the founder's own device — 30 rows
backfilled, only 6 nights (2–7 Sep) carried data, matching the day he began wearing the
Vívoactive 5.
Consequences that must be designed for, not patched later:
- Onboarding must frame the first 14 nights as building a record, never as failure.
- D-009 L3 integrity flags stay suppressed until ≥14 baseline nights exist (spec §5 already
  requires ≥14; this makes the UI consequence explicit).
- Streaks and lifetime counts start at zero for everyone. A pod cannot compare "history".
- A user who joins a pod on day 1 has no baseline; the pod's first cycle is therefore also
  everyone's baseline period.
Status: DECIDED

## D-026 · 2026-09-07 · Commitment realism is a product problem, not a user problem
Founder set 23:00 / 07:00 / ±30. All six nights with data derived MISSED; real sleep onset was
23:34–23:46. A promise broken every night teaches nothing, and inside a pod it would be
humiliating rather than motivating — which would attack the core thesis (D-001) directly.
Design consequence for the commitment screen (T-004 or earlier):
- When ≥7 nights of history exist, show the user their actual median bed/wake time while they
  are choosing, and warn when the chosen target sits far outside it.
- Do not auto-set the target. Suggest, never impose.
- Revisit tolerance defaults once real distributions exist across more than one person.
Status: DECIDED (implementation deferred; recorded now so it is not lost)

## D-027 · 2026-09-07 · Phone is a pipe, not a sensor — restated after founder question
Zenoho2 never reads phone sensors. The chain is wearable → vendor app → Health Connect /
HealthKit → Zenoho2. This restates D-003 because the distinction was not obvious in use: the
app looks like it is reading the phone, and it is not. Any user-facing copy must make this
explicit, because a user who thinks the phone is measuring will not understand "no data".
Status: DECIDED

## D-028 · 2026-09-07 · Manifest-permission diff test
A test compares intended permissions against the generated AndroidManifest and fails on
divergence. Approved after three permission-related device failures in one day, each invisible
to tests, typecheck and prebuild.
Status: DECIDED (implemented in T-002)

## D-029 · 2026-09-07 · Handoff files stay local, never committed
Handoff files stay local, never committed; the repo is public so the checker can clone it, and
personal/operational inventory must not be in it.
Enforced by `HANDOFF-*.md` in .gitignore. What such a file carries — founder name, account
names, planned spend, token names and expiries, strategic risk list — is an inventory of the
setup, not a secret in itself, but a public repo is the wrong place for it.
Status: DECIDED

## D-030 · 2026-09-07 · Public repo is world-readable at all times
HANDOFF purged from git history 2026-09-07; treat the public repo as world-readable at all
times — no personal, operational or financial detail is ever committed.
Method: `git filter-repo --path HANDOFF-2026-09-07.md --invert-paths`, followed by a force-push
to origin/main. Verified: `git log --all --full-history -- HANDOFF-2026-09-07.md` returns
nothing; the file remains on disk and gitignored (D-029).
Caveat recorded rather than glossed: a rewrite removes the file from this repository's history,
not from any clone, fork or cache made while it was published. It was live on a public repo
between commits 51031a6 and 0f3c192. It contained no secret values — no token strings, keys or
passwords — so the exposure is an inventory of the setup, not a credential leak. Anyone who
cloned in that window still has it. Rewriting was still worth doing; assuming it undoes the
publication is not.
Consequence for everyone working in this repo: history rewrites invalidate existing clones. A
clone taken before this point must be re-cloned, not pulled.
Status: DECIDED

## D-031 · 2026-09-08 · Backend provider
Supabase, region **ap-south-1 (Mumbai)**. Rationale: managed Postgres + auth + RLS + edge
functions + pg_cron in one free-tier project; Mumbai region keeps health-derived data in India
(DPDP posture); no server process for a solo founder.
The publishable key is public by design and lives in `app/.env` only; the service-role / secret
key never leaves the Supabase dashboard and edge-function secrets. Recorded by T-003.
Note on key type: the new-style `sb_publishable_…` key is used, not the legacy anon JWT.
Status: DECIDED

## D-032 · 2026-09-08 · Sign-in method
Email one-time code (Supabase email OTP). No phone OTP (needs a paid SMS provider), no Google
sign-in in v1 (OAuth client setup is pure friction for 5–8 gym users). Display name only; no
profile photo. Recorded by T-003.
Status: DECIDED

## D-033 · 2026-09-08 · Gated roadmap
Gated roadmap — no stage beyond v1 is built until its gate is passed by real usage.

**v1.1** (movement promise, visibility toggle, margin unlock, doubt mark, iOS, Play listing)
requires ≥60% of the gym pod active at day 28, and witness-reacted users keeping more nights
than non-reacted.

**v1.2** (shared pod commitment, multi-pod, in-pod invites) requires two more pods completing a
cycle and one organic recruit.

**v2** (pod discovery, brand verification at scale, possible cheap-watch layer) requires pods
forming without the founder.

The roadmap is a hypothesis list, not a plan.

Note: the v1.1 gate is the direct test of D-001's core untested assumption — that an
app-mediated witness reproduces the human-witness effect. If witness-reacted users do not keep
more nights than non-reacted, the thesis has failed its first real measurement, and building
v1.1 would be building on a hypothesis that has just been disconfirmed.
Status: DECIDED

## D-034 · 2026-09-08 · Clock skew is measured without sending a timestamp
The server sets `daily_states.computed_at` itself (`timestamptz DEFAULT now()`). The client
sends `device_clock_offset_min` — an integer, whole minutes, device time minus server time,
taken from a one-time server-time probe.
Why: the network guard's invariant is absolute — no epoch-ms values, no ISO instants, ever —
and that invariant is what makes AC-9 provable by inspection rather than by argument. Sending
`computed_at` from the device would have required a first exemption, after which every later
exemption gets easier to argue for. Measuring skew is worth doing; it is not worth spending the
property that makes the privacy claim checkable.
Consequences: spec §8 gains `device_clock_offset_min` on `daily_states`. AC-3.4 stands as
written. The server timestamp is also the more trustworthy one — a client cannot misreport when
it derived a night.
Supersedes the T-003 open item on clock skew, which is replaced by: report the distribution of
`device_clock_offset_min`.
Status: DECIDED

## D-035 · 2026-09-08 · Legacy Supabase project found and left alone
The first Supabase project connected on 2026-09-08 contained a legacy Zenoho schema
(marker_results 135 rows, panels, analysis_failures, domains, markers, systems, profiles),
created 2026-06-14. Zenoho2 moved to a fresh project the same day. The legacy project was left
untouched; it may contain real health data and is not ours to delete.

Detail, so this is not rediscovered: the collision was found by querying the live database after
applying migration 0001, not by reading a file. Zenoho2's four tables (users, commitments,
daily_states, push_tokens) applied cleanly alongside the legacy ones and were correctly
isolated — RLS enabled and forced, no anon policy — so nothing was broken. The objection is
D-000, not correctness: Zenoho2 is a clean-room restart and must not share a database with a
prior attempt's data.

Nothing in the legacy project was dropped, altered or exported. The migration Zenoho2 applied
there remains, as do its four empty tables; removing them would itself be a modification, and
the ruling was to leave the project alone.
Status: DECIDED

---

## FINDINGS LOG — 2026-09-07 (evidence, not decisions)

### Device pipeline (S26 Ultra, Android 16 / One UI 8.5, Garmin Vívoactive 5)
- Garmin Connect Android dataOrigin: `com.garmin.android.apps.connectmobile` — verified.
- Garmin writes SleepSession, HeartRate AND RestingHeartRate to Health Connect.
- Health Connect background read available and granted on Android 16.
- Health Connect page cap is 1000 records, oldest-first; unpaginated wide reads silently
  truncate. Fixed by scoping HR reads to the selected session plus pagination.
- `READ_RESTING_HEART_RATE` is a separate permission from heart rate ("Vitals" in the consent
  sheet grants HR, not RHR).
- Real night observed: sleep 23:46 → 08:00, 963 HR samples, wear ratio 100%.
- Morning notification fired 2026-09-08 at 08:05 for an 08:00 daily trigger, laptop off, app
  battery setting "Optimised". Samsung batches inexact alarms; a 0–15 min delay is expected
  platform behaviour, not a defect. Exact alarms deliberately NOT adopted: `expo-notifications`
  exposes no exact/alarm-clock trigger, and the delay costs nothing because derivation runs on
  app foreground regardless.

### Integration failure pattern (three failures, one day)
All three were invisible to a green suite, a clean typecheck and a successful prebuild:
1. Undeclared manifest permission (run 1).
2. Platform paging default (run 2).
3. A failed read returning an empty array would have been persisted as a genuine NO_DATA night
   — caught in review, not by tests. `readNight` now returns `readErrors`.
Implication carried forward: no acceptance criterion involving the platform may be marked met
without a device run. Applies to every task from here.

### Still never executed on device
- iOS bridge, in whole (D-013).
- Nothing else as of R-002 device run — the D-020 SQLite write path executed 2026-09-07 via the
  forced-fallback acceptance tool (RHR nights 1, fallback yes).

### Distribution facts (2026-09-07)
- Sideloaded APKs get full Health Connect permissions; the Play declaration is a publishing
  requirement, not a permission requirement. Proven by the preview build.
- Google developer-identity verification for sideloaded apps is rolling out through
  September 2026. Treat sideloading as workable-now, not guaranteed-for-a-year. UNVERIFIED
  for India timing.
- iOS has no equivalent: TestFlight or ad-hoc only, both requiring the paid Apple account.

---

## OPEN ITEMS (blocked on a device, not on a person)
- CLOSED 2026-09-07 (R-001 run 2, S26 Ultra + Vívoactive 5): Garmin Connect Android writes
  sleep, heart rate AND resting heart rate to Health Connect. Observed dataOrigin is
  `com.garmin.android.apps.connectmobile`; allow-list v2 marks it verified.
- CLOSED 2026-09-07 (same run): Health Connect background read IS available and was granted on
  Android 16 / One UI 8.5. Spec §12's "Android 15+" note holds.
- Verify: Fire-Boltt → HealthKit / Health Connect sleep write.
- Verify: boAt / Noise → Health Connect sleep write (Android).
- Verify: Ultrahuman → Health Connect.
- Verify: HealthKit background delivery works via the chosen RN binding on a physical iPhone.

## UNTESTED ASSUMPTIONS (carried into beta)
- App-mediated witness reproduces human-witness effect (D-001).
- 28-day cycle length (D-006).
- One-reaction-per-day loop drives return visits without performative drift (D-005).
- ~1/3 of an invited group actually connects and shares (US survey: 63% willing; India unknown).
