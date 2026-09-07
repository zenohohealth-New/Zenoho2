# T-002 · Local nightly engine (no backend)

Status: IN_REVIEW · Owner: Claude Code (maker) · Reviewer: Claude Web (checker)
Report: reports/R-002-local-engine.md (2026-09-07). Engine built; 105 tests, typecheck, lint
and check:manifest clean. Device run done on the S26 Ultra (preview APK 69516f42):
AC-2.1, AC-2.4, AC-2.5 MET; AC-2.2 NOT MET (6 nights with data, target >=7 — Health Connect
holds only ~6 nights of Garmin history); AC-2.7 pending overnight; AC-2.3 and AC-2.6 half-met
(test yes, device no). Only the checker marks this DONE.
Spec: spec/ZENOHO2-V1-SPEC.md §4, §5, §6 (commitment only), §10 (morning push only), §11 (screens 4 and 6 in local form), §12
Decisions: D-002, D-003, D-006, D-009, D-010, D-012, D-016, D-017, D-019, D-020, D-022, D-023
Supersedes the earlier plan to do the backend second. Backend is now T-003.

## Goal
A standalone app on the founder's phone that, with no server and no account, lets him set a sleep commitment, derives a state every morning by itself, stores the history locally, and shows it. This exercises the D-020 SQLite write path that R-001 flagged as never-executed, and starts accumulating the 14+ nights the L3 baseline needs.

## Deliverables
1. **Commitment screen** — bed target, wake target, tolerance (15/30/45/60, default 30). Persisted in SQLite. Editable freely in T-002 (the D-006 cycle-boundary lock arrives with cycles in T-004).
2. **Nightly persistence** — `daily_states` table per spec §8 field list, local only. Upsert on (commitment, night_date). Revision and freeze rules per §5, including `revisionCount` and the 14:00 local freeze.
3. **Scheduled derivation** — runs on app foreground, and at wake_target + 60 min via a local notification (`expo-notifications`) that triggers a sync when opened. Background-fetch is optional; if attempted, report whether it actually fired on Android 16.
4. **History screen** — last 30 nights as a simple list: date, state, streak. Plus the current cycle streak and lifetime kept-count per §6. No scores, no physiology, no charts.
5. **Harness retained** — the T-001 diagnostic screen stays, reachable from a hidden entry point (e.g. long-press the header), per D-022.
6. **Backfill** — on first run, derive and store the last 30 nights from Health Connect history, so the app has data immediately.
7. **Preview APK** — an EAS `preview` build the founder can install and use with no laptop (D-023).
8. `reports/R-002-local-engine.md` in the README format.

## Constraints
- No backend, no auth, no BaaS SDK, no network calls at all. The D-010 guard must remain in place and untested-by-use is fine; do not add an upload path.
- No pods, witness, reactions, cycles, check-ins, invites — those are T-004/T-005.
- Copy rule (spec §11): no health claims; "research associates…" only.
- Minimal dependencies; justify each.
- UI can be plain but must not look broken: real empty states, real error states.

## Acceptance criteria
- **AC-2.1** Setting a commitment and reopening the app preserves it (SQLite proven by app restart, not by unit test alone).
- **AC-2.2** Backfill produces ≥ 7 stored nights on the founder's device on first run; report the actual count and the state distribution.
- **AC-2.3** A night derived before 14:00 local can be revised once and not twice; after 14:00 it is frozen. Prove with a test and describe how it was checked on device.
- **AC-2.4** The D-020 SQLite write path executes on device. Force it: temporarily ignore Garmin's RestingHeartRate and use the on-device fallback, confirm rows are written and read back, then restore. Report row counts before and after.
- **AC-2.5** Retention: rows older than 45 days are purged; prove with seeded old rows on device.
- **AC-2.6** No network request is made by the app in a full session (intercept or proxy check).
- **AC-2.7** Preview APK installs and runs with the laptop off; morning notification fires and the state appears without opening anything else first.
- **AC-2.8** Timezone: describe what happens if the phone changes timezone mid-history; D-016 TRAVEL must still apply.

## Open items to surface
- Whether Android 16 background derivation is reliable enough to drop the morning notification later.
- Whether Garmin ever writes two sleep sessions for one night (run 3 read 2 sessions — confirm which was selected and why).

## Closing block
Mandatory, per CLAUDE.md.
