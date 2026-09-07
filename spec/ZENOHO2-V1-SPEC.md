# ZENOHO2 — V1 SPECIFICATION

Version 1.0 · 2026-09-07 · Author: Claude Web (checker) · Owner: Founder
Governing decisions: decisions/DECISIONS.md D-001 … D-012. Where this spec and the log disagree, the log wins.

## 1. One-line product

A small group of people you already know, each keeping one device-verified sleep-window promise for 28 days, with one named witness who sees only kept / missed / no-data.

## 2. In scope (v1)

1. Account + onboarding with HealthKit (iOS) / Health Connect (Android) permission.
2. Device eligibility check (Tier 1 source present in last 7 days).
3. Create pod (3–8) via invite link; join pod.
4. Sleep-window commitment: target bed time, target wake time, tolerance.
5. Witness selection inside pod (one witness per member; a member may witness up to 2 others).
6. On-device daily state derivation: KEPT / MISSED / NO-DATA + integrity flag.
7. Home: my today, my witness's view of me, the person I witness, pod aggregate, streaks.
8. One reaction per day from witness (NOD on kept, NUDGE on missed/no-data).
9. Weekly check-in prompt (day 7/14/21) and 28-day cycle renewal.
10. Push notifications: morning sync trigger, witness miss alert, weekly check-in, cycle end.
11. Privacy: data export, delete account (hard delete within 72h), per-pod leave.

## 3. Out of scope (v1) — do not build

Movement commitment (v1.1) · symmetric pod visibility toggle (v1.1) · shared pod commitment (v1.2) · margin unlock (v1.1) · witness doubt mark (v1.1) · any score, leaderboard, feed, comments, DMs · phone-only sleep · HRV/RHR display · any AI insight · payments · web app.

## 4. Definitions

- **Main sleep session**: the longest sleep session with start between 18:00 local (day D) and 12:00 local (day D+1), from an eligible source.
- **Eligible source**: a sleep session whose source/origin package is a wearable companion app (allow-list in §9), not the phone OS, not a manual entry.
- **Wear presence**: ≥ 1 heart-rate sample per 30-minute bucket for ≥ 70% of buckets inside the main sleep session.
- **Commitment**: {bed_target, wake_target, tolerance_min ∈ {15, 30, 45, 60}, default 30}.
- **Night D** belongs to the calendar day the user wakes.

## 5. Daily state derivation (runs on device)

Input: HealthKit / Health Connect reads for the last 48 h (sleep sessions + heart rate), commitment, local timezone.

```
if no main sleep session from eligible source         → NO_DATA, integrity = NO_SOURCE
elif wear presence < 70%                               → NO_DATA, integrity = NO_WEAR
else:
  bed_dev  = sleep_start − bed_target   (minutes, signed)
  wake_dev = sleep_end   − wake_target  (minutes, signed)
  if |bed_dev| ≤ tol and |wake_dev| ≤ tol              → KEPT
  else                                                  → MISSED
  integrity = OK
  # L3 coherence (v1: flag only, member-visible only)
  if 7-day median RHR deviates > 12 bpm from 30-day baseline (needs ≥ 14 baseline nights)
                                                        → integrity = UNVERIFIED
deviation_min = max(|bed_dev|, |wake_dev|) rounded to 5
```

Rules:
- Derivation runs at: app foreground; background delivery/read where the OS allows; and on the morning push (wake_target + 60 min).
- A day's state may be revised once until 14:00 local (late syncs); after that it is frozen.
- Timezone change > 3 h in a day → that night = NO_DATA, integrity = TRAVEL (not counted against streak).
- Streak counts KEPT only; MISSED resets cycle streak; NO_DATA/TRAVEL neither counts nor resets, but 3 consecutive NO_DATA nights show a "device?" prompt to the member.

## 6. Cycle

- Pod cycle: 28 days, starts the Monday after pod reaches ≥ 3 members and every member has a commitment + witness. Creator can start early with ≥ 3.
- Weekly check-in on days 7, 14, 21: one screen — "How's it going?" with two taps (fine / struggling) and optional 140-char note visible to witness only.
- Day 28: renewal screen. Commitment carries over unless edited. Commitment edits only here.
- Lifetime counters: nights_kept, cycles_completed (≥ 20/28 kept). Cycle counters reset each cycle.

## 7. Roles and visibility (D-004, D-005, D-010)

| Viewer | Sees about member M |
|---|---|
| M | own state, deviation_min, integrity flag, streaks, counters |
| M's witness | state (KEPT/MISSED/NO_DATA/TRAVEL), cycle streak, weekly note; NOT deviation, NOT integrity, NOT times |
| Pod | aggregate only: "x of n kept last night", pod cycle kept-rate |
| Server | state, source_id, wear_presence bool, deviation_min, integrity flag — never raw sessions or HR |

Reactions: witness may send one of {NOD, NUDGE} per member per day. Member sees it; counts are never displayed anywhere.

## 8. Data model (server)

```
users(id, display_name, tz, platform, created_at, deleted_at)
pods(id, name, creator_id, cycle_start, cycle_no, created_at)
pod_members(pod_id, user_id, role{creator,member}, witness_user_id, joined_at, left_at)
commitments(id, user_id, pod_id, cycle_no, bed_target, wake_target, tolerance_min, created_at)
daily_states(id, commitment_id, night_date, state{KEPT,MISSED,NO_DATA,TRAVEL},
             integrity{OK,UNVERIFIED,NO_SOURCE,NO_WEAR,TRAVEL}, source_id, wear_presence bool,
             deviation_min int, computed_at, frozen bool)   UNIQUE(commitment_id, night_date)
reactions(id, from_user_id, to_user_id, night_date, kind{NOD,NUDGE}, created_at)
             UNIQUE(from_user_id, to_user_id, night_date)
checkins(id, user_id, pod_id, cycle_no, week_no, mood{FINE,STRUGGLING}, note, created_at)
invites(token, pod_id, created_by, expires_at, used_by)
push_tokens(user_id, token, platform)
```
Row-level security: a user reads own rows; witness reads `state` and `checkins.note` of assigned members only via a view that excludes deviation/integrity; pod members read the aggregate via a view. No client can read `daily_states` of non-assigned users.

## 9. Eligible source allow-list (v1; extend by evidence)

iOS (HealthKit sourceRevision bundle prefixes): `com.apple.health` (Apple Watch), Garmin, Zepp/Amazfit, Xiaomi Mi Fitness, Oura, WHOOP, Ultrahuman, Polar, Withings, Fitbit-bridge apps (BitSync etc. flagged UNVERIFIED).
Android (Health Connect dataOrigin package): `com.sec.android.app.shealth`, Google Health/Fitbit, Garmin Connect, Zepp, Mi Fitness, Oura, WHOOP, Polar, Withings. Ultrahuman: UNVERIFIED.
Unknown origin with HR present → accept as eligible but integrity = UNVERIFIED (so a new brand doesn't silently exclude). Unknown origin with no HR → NO_DATA.

## 10. Notifications

| Trigger | To | Time |
|---|---|---|
| Morning sync | member | wake_target + 60 min (opens app → derivation) |
| Missed/no-data | witness | after member's state freezes or by 14:00 |
| Reaction received | member | immediate |
| Weekly check-in | member | day 7/14/21, 19:00 local |
| Cycle ends in 2 days / renew | member | day 26 and 28 |
| Pod aggregate | all | 09:30 local daily, single line |

Max 2 pushes/day/user. All opt-out per type.

## 11. Screens (v1)

Welcome → Connect device (permission + eligibility check with clear "your device isn't supported yet" + Mi Band/Amazfit suggestion) → Create or join pod → Set commitment (bed/wake/tolerance; shows what witness will and won't see) → Choose witness → Home → Reaction sheet → Weekly check-in → Renewal → Settings (privacy, export, delete, leave pod).

Copy rule: every health statement uses "research associates…"; never "improves", "reduces risk", "healthy".

## 12. Platform constraints (must be respected)

- Health Connect: declare read permissions for SleepSession, HeartRate; request READ_HEALTH_DATA_IN_BACKGROUND (Android 15+) and READ_HEALTH_DATA_HISTORY. File Play Console health declaration in week 1 (approval ≤ 7 days + whitelist 5–7 business days).
- HealthKit: NSHealthShareUsageDescription; enable background delivery for sleepAnalysis + heartRate; no writes.
- Store nothing from HealthKit/HC on the server except the derived fields in §7.
- Minimum OS: iOS 16, Android 9 (HC requires API 26; HC is system-installed from Android 14).

## 13. Acceptance criteria (checker will test against these)

AC-1 Fresh install on device with Tier-1 wearable data → eligibility passes; on a phone with no wearable → clear rejection with device suggestion.
AC-2 Given fixtures (sleep sessions + HR), derivation returns the states in tests/fixtures/derivation-cases.json — including: kept within tolerance; missed by bed; missed by wake; no HR → NO_DATA; manual entry → NO_DATA; two sessions → longest chosen; timezone jump → TRAVEL; late sync before 14:00 revises, after 14:00 does not.
AC-3 Witness API/view returns state and note only; a direct query for deviation_min or integrity of a non-self member fails RLS (test must prove denial).
AC-4 Pod aggregate matches sum of frozen states; unfrozen nights excluded.
AC-5 One reaction per (witness, member, night) enforced at DB level.
AC-6 Cycle starts/ends per §6 across timezones; renewal carries commitment; edit only at boundary.
AC-7 Delete account removes all rows within 72 h (test with job run); export produces JSON of the user's own rows.
AC-8 Push volume ≤ 2/day/user in a simulated 28-day run.
AC-9 No raw sleep or HR value appears in any network request (intercept test).
AC-10 App runs on iOS + Android physical devices; background sync verified once per platform (report must say which device).

## 14. Non-functional

Solo-operable: no servers to patch. Cost target ≤ ₹5,000/month at ≤ 500 users. All secrets in env; none in repo. Test suite runs in CI on push.

## 15. Metrics the beta must emit (for Q2/Q3/Q6)

- invited → installed → connected → committed → first KEPT (funnel)
- % who set visibility to minimum (n/a in v1, all minimum) → track opt-ins to margin when v1.1 ships
- 7/14/21/28-day retention; where in the cycle drop-off occurs
- kept-rate for members whose witness reacted ≥ 3×/week vs < 3×/week (natural experiment for D-001)
- exit reason (single free-text on leave/delete)
