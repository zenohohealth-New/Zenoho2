# T-001 · Foundation: repo, health-store bridge, on-device derivation

Status: IN_REVIEW · Owner: Claude Code (maker) · Reviewer: Claude Web (checker) · Approver: Founder
Report: reports/R-001-foundation.md (2026-09-07). Deliverables 1-6 complete; device
evidence for AC-1 and the AC-10 Android half is NOT met - nothing has run on a phone.
Only the checker marks this DONE.
Spec: spec/ZENOHO2-V1-SPEC.md §4, §5, §9, §12, §13 (AC-1, AC-2, AC-9, AC-10 Android half)
Decisions: D-003, D-009, D-010, D-011, D-012, D-013, D-014

## Goal
A running Expo app on Android (iOS code compiles but is untested — D-013) that (1) reads sleep sessions + heart rate from Health Connect / HealthKit, (2) runs the daily-state derivation locally against fixtures and live data, (3) proves no raw health values leave the device. No backend, no pods, no UI polish in this task.

## Deliverables
1. Repo layout per README.md; `app/` Expo project with custom dev client; `tests/` with derivation fixtures.
2. `app/src/health/` — platform bridge exposing one interface:
   `readNight(date, tz) → { sessions: SleepSession[], hr: HrSample[] }` with source/origin metadata preserved.
3. `app/src/derive/` — pure TypeScript module implementing spec §5 exactly. No platform imports. 100% unit-testable.
4. `tests/fixtures/derivation-cases.json` — at minimum the cases listed in AC-2; each case has input + expected output.
5. Eligibility check per AC-1 with the §9 allow-list as a versioned JSON file.
6. Network guard: a test that stubs fetch and asserts no request body contains any sleep timestamp or HR value.
7. `reports/R-001-foundation.md` in the implementation-report format (README.md).
   Android-only evidence (D-013, D-014): report the physical Android device by model + OS version
   and whether a Health Connect read fired on it. iOS is marked DEFERRED — no iOS device or Mac
   exists yet; iOS results must never be fabricated or inferred. iOS re-enters scope when an Apple
   Developer account exists and an EAS cloud build reaches TestFlight.

## Constraints
- Do NOT add a backend, auth, or any BaaS SDK in this task.
- Do NOT write to HealthKit/Health Connect.
- Do NOT store raw sessions beyond the app's local sandbox; purge anything older than 45 days.
- Keep dependencies minimal; justify each in the report.
- Copy rule from spec §11 applies to any placeholder text.

## Verification (checker will run these)
- `npm test` passes; derivation cases all green; add at least 5 cases beyond AC-2 and list them.
- Report names the physical Android device (model + OS version) and whether a Health Connect
  read/background read fired at least once on it. iOS row = DEFERRED with the reason, never a result.
- Report lists assumptions, unresolved issues, risks, recommended next step.

## Open items to surface (do not resolve silently)
- Health Connect background read availability on the test Android's OS version.
- Actual dataOrigin/bundle strings observed from the test wearables (add to allow-list PR with evidence).
