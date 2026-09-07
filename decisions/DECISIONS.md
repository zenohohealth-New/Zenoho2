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
Status: DECIDED

## D-014 · 2026-09-07 · First test device
First test device: Samsung Galaxy S26 Ultra + Garmin Vívoactive 5, Garmin Connect → Health Connect, verified working by founder on 2026-09-07.
Status: DECIDED

---

## OPEN ITEMS (blocked on a device, not on a person)
- Verify: Fire-Boltt → HealthKit / Health Connect sleep write.
- Verify: boAt / Noise → Health Connect sleep write (Android).
- Verify: Ultrahuman → Health Connect.
- Verify: HealthKit background delivery works via the chosen RN binding on a physical iPhone.

## UNTESTED ASSUMPTIONS (carried into beta)
- App-mediated witness reproduces human-witness effect (D-001).
- 28-day cycle length (D-006).
- One-reaction-per-day loop drives return visits without performative drift (D-005).
- ~1/3 of an invited group actually connects and shares (US survey: 63% willing; India unknown).
