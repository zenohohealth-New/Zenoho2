# R-002 · Local nightly engine (no backend)

Task: tasks/T-002-local-nightly-engine.md · Maker: Claude Code · Status set to IN_REVIEW
Spec sections read: §4, §5, §6, §8, §10, §11, §12 · Decisions: D-002, D-003, D-006, D-009,
D-010, D-012, D-016, D-017, D-019, D-020, D-022, D-023, D-024
Date: 2026-09-07

> **Headline for the checker:** the engine is built and every gate is green — 99 tests,
> typecheck clean, lint clean. **Nine of the ten acceptance criteria cannot be signed off from
> this machine**, because they are device facts: AC-2.1 through AC-2.7 all say "on device" or
> "prove by restart". The preview APK (D-023) is built; §9 stays open until it has been run.
> Two real bugs were found and fixed on the way, both in code T-001 shipped as green.

---

## 1. What changed

**Schema (D-020).** SQLite migration 2 adds `commitments` and `daily_states`. `daily_states`
carries the spec §8 column list plus `revision_count`, which §8 has no column for because it
never crosses the wire (D-010). One row per `(commitment_id, night_date)` is enforced by the
primary key rather than by application code, so a double-derive cannot duplicate a night.

**Engine.** `src/engine/nightlyEngine.ts` is the whole of T-002's logic: read the health store,
derive on device, apply the §5 revision and freeze rules against whatever is already stored,
persist. Two behaviours are worth the checker's attention:

- It **refuses to store anything** when the sleep read failed and no row exists. An empty read
  is not evidence of a quiet night (R-001 §12), and writing NO_DATA on that basis would
  fabricate a miss the member never had.
- **Backfill covers the nights *before* today**, not including it. Today is derived separately
  by the caller so the §5 rules apply to it normally — folding it into backfill would consume
  its single allowed revision on first run, for nothing.

**Morning trigger.** One *local* notification a day at `wake_target + 60` (spec §10 row 1).
Local, not push: there is no server and no network, and a local notification needs neither.
Spec §10 caps pushes at 2/day/user; this schedules exactly one, and reschedules rather than
stacking when the commitment changes.

**Screens.** Commitment (spec §11 screen 4) and History (screen 6 in local form). The history
screen shows state, streak and lifetime kept-count and nothing else — no score, no chart, no
physiology, no comparison (D-005, D-007). Real empty states and a real error state, and the
error state says explicitly that a failed read is not a missed night.

**Harness retained (D-022).** The T-001 diagnostic screen now lives behind a long-press on the
title. It also carries the two acceptance tools that cannot be proven any other way on a
device: a toggle that forces the D-017 fallback so the D-020 SQLite write path executes
(AC-2.4), and a probe that seeds a 60-day-old row and runs retention against it (AC-2.5).

---

## 2. Files changed

**Created**
```
app/src/storage/commitmentStore.ts   the commitment, versioned by insert not update
app/src/storage/dailyStateStore.ts   daily_states CRUD + retention + row counts
app/src/engine/nightlyEngine.ts      derive -> revise -> persist; backfill; summaries
app/src/engine/morningSync.ts        the one local daily trigger (spec §10)
app/src/ui/theme.ts                  shared tokens, date and time formatting
app/src/ui/CommitmentScreen.tsx      spec §11 screen 4
app/src/ui/HistoryScreen.tsx         spec §11 screen 6, local form
app/src/ui/HarnessScreen.tsx         T-001 harness (D-022) + acceptance tools
tests/engine.test.ts                 engine behaviour incl. AC-2.2, AC-2.3, AC-2.5
tests/no-network.test.ts             AC-2.6, static half
reports/R-002-local-engine.md        this file
```

**Modified**
```
app/App.tsx                  rewritten as the router; was the T-001 harness
app/src/storage/db.ts        migration 2; SCHEMA_VERSION derived from the ladder
app/src/derive/index.ts      freezeAtMs — the freeze bug below
app/src/health/rhrHistory.ts forceFallback, for AC-2.4
app/app.json                 expo-notifications plugin + POST_NOTIFICATIONS
app/tsconfig.json            ambient node types for the AC-2.6 scan
decisions/DECISIONS.md       D-021 placeholder, D-022, D-023, D-024
tasks/T-001-foundation.md    DONE (approved by checker)
```

**Dependencies added** — three, each justified:

| Package | Why |
|---|---|
| `expo-sqlite` | D-020. The single on-device store. Approved by the checker before T-002. |
| `expo-notifications` | Deliverable 3 / spec §10. Local notifications only; no push service, no token, no network. |
| `@types/node` (dev) | AC-2.6's proof is a static scan of the app's own source files, which needs `fs`. Types-only, dev-only, ships nothing. It was already present transitively via vitest; declaring it explicitly avoids depending on that accident. |

---

## 3. Tests run

| Gate | Command | Result |
|---|---|---|
| Unit + fixtures | `npm test` | **99/99 passed**, 8 files |
| Typecheck | `npm run typecheck` | **clean** |
| Lint | `npm run lint` | **clean**, 0 errors 0 warnings |
| Native config | `npx expo prebuild --platform android --clean` | **succeeded**; manifest inspected |
| Preview APK | `eas build --profile preview --platform android` | built (D-023) |
| Device run | — | **NOT YET RUN** — see §9 |

New coverage this task: 15 tests across `engine.test.ts` and `no-network.test.ts`, plus two
regression cases for the freeze bug in `derive.test.ts`.

### On the AC-2.6 network test

The runtime intercept AC-2.6 asks for is a device measurement and is listed in §9. What runs
here is the static half, and it is deliberately built to be able to fail: it asserts it found
more than ten source files before asserting they are clean, so a scan that silently matched
nothing cannot pass. It checks four things — no network API is called outside `src/net`, no
HTTP or backend client is imported, no backend package is declared, and **nothing in the app
imports the upload boundary at all**. That last one is the real content: `src/net` exists and
is tested, but T-002 contains no path that reaches it.

---

## 4. Tests passed / failed

**Passed: 99. Failed: 0.** Nothing skipped, `.only`'d or marked todo.

One test failed while I was writing it and the failure was mine, not the code's: I had assumed
`backfill(5)` would include today. It does not, by design. I corrected the expectation and
documented the boundary rather than changing the behaviour to match my assumption — including
today would have burned its revision budget on first run.

---

## 5. Two bugs found in code T-001 shipped as green

**The freeze rule was reading the wrong clock.** `applyRevision` decided a night was frozen by
checking whether the *current* time of day was past 14:00 — not whether 14:00 had passed *on
that night's date*. A night from last week was therefore revisable every morning and frozen
every afternoon, forever. It never showed up in T-001 because T-001 only ever derived today,
where the two readings coincide. Backfill is made entirely of past nights, so it surfaced
immediately. Fixed with `freezeAtMs(nightDate, tz)`, anchored to the night; two regression
tests, one of which fails against the old logic.

**`POST_NOTIFICATIONS` was missing from the manifest.** `expo install expo-notifications` adds
the package but does not register its config plugin, so the permission never reached the
manifest. Android 13+ requires it and the test device runs Android 16 — the morning trigger
would have failed silently on the very device it was built for. Caught by inspecting the
generated manifest rather than by any test. This is the third manifest-permission problem in
two tasks (`READ_RESTING_HEART_RATE` was the first two runs' failure), which is a pattern worth
naming: **`expo install` adding a package is not the same as the permission existing**, and
nothing in the local toolchain checks the difference.

---

## 6. Assumptions

1. **"Current cycle streak per §6" with no cycles.** T-002 has no cycles (T-004), so there is
   nothing for a cycle streak to reset against. Read as: the streak over everything stored,
   using the §5 rules — KEPT counts, MISSED resets, NO_DATA and TRAVEL do neither. Lifetime
   kept-count is every stored KEPT. **Flag if you meant something narrower.**
2. **Free commitment editing diverges from D-006 and §6**, which allow edits only at a cycle
   boundary. The task states this explicitly and defers the lock to T-004; recorded in
   `commitmentStore.ts` so the divergence is visible in the code, not only in the task file.
3. **A new commitment is a new row, not an update.** Once `daily_states` references a
   commitment id, updating in place would silently rewrite the history of what was promised.
4. **Backfill runs oldest-first**, so the D-017 fallback accumulates RHR as it goes and a later
   night can see a baseline built by earlier ones.
5. **`daily_states` shares the 45-day retention** with raw samples. States are derived facts,
   not raw health data, so a longer horizon would be defensible — but one retention rule on the
   device is easier to audit than two. Note the consequence: history is capped at 45 days, which
   is fine for a 28-day cycle and would need revisiting for lifetime counters that outlive it.
6. **Backfill is bounded at 30 nights** because spec §12 says Health Connect keeps 30 days by
   default. `READ_HEALTH_DATA_HISTORY` is granted, so more may be available; 30 is the
   conservative floor, not a measured limit.

---

## 7. Unresolved issues

1. **The SQLite code still has not executed anywhere.** This was R-001 §6.3's carried-forward
   gap and it is *still* open: the stores cannot run in the Node suite (native module), so
   `engine.test.ts` drives the engine against an in-memory stand-in for the same contract. The
   SQL — migration 2, both upserts, both retention `DELETE`s — is proven only by inspection.
   AC-2.4 and AC-2.5 exist precisely to close this on device, and the harness now carries the
   tools to do it. **This is the single largest risk in T-002.**
2. **Android 16 background derivation is untested** (T-002 open item). The morning notification
   is the design D-011 chose because background reads are not guaranteed; whether the
   notification can be dropped later is unknown and needs several days of observation, not one
   run.
3. **Two sleep sessions per night** (T-002 open item). Run 3 of T-001 read 2 sessions for one
   night. §4 selects the longest eligible one, and the harness prints the selected session's
   span, so the next device run can answer which was chosen and why — but it has not yet.
4. **Timezone mid-history (AC-2.8) is reasoned, not observed.** See §8.
5. **`expo-notifications` may warn about push tokens in a preview build.** Local notifications
   need none; if a warning appears on device it is cosmetic, but it should be recorded rather
   than dismissed.
6. **Play Console health declaration still not filed.** Unchanged since R-001, still the
   longest lead time on the board, still unstarted.

---

## 8. AC-2.8 — timezone change mid-history

Asked for as a description, so: nights are keyed by local date, and each night's state is
derived with the UTC offset supplied for that night. Moving timezone therefore does not
retroactively change stored nights — they keep the state they were derived with, which is the
behaviour you want, since the member really did keep or miss that promise where they were.

For the night of the move, D-016 applies: when the offset moved more than 3 hours from the
previous day, the night is `state = TRAVEL, integrity = TRAVEL`, and §5's streak rules make it
neither count nor reset. Fixture `AC2-07` covers this and passes.

**The honest gap:** the engine currently derives each night without passing
`prevTzOffsetMin`, because it has no stored record of what the offset *was* on each past
night — only what it is now. So TRAVEL is reachable in the derivation and proven by fixture,
but the engine cannot *trigger* it in the field yet. Closing that needs an offset column on
`daily_states`, which is a schema change and outside T-002's stated deliverables. **Recommend
it for T-003 or T-004**; until then, a real timezone move will produce ordinary KEPT/MISSED
states against the new local clock rather than TRAVEL. I have not hidden this behind the
passing fixture.

---

## 9. Devices used (physical, with OS version)

| Platform | Device | State |
|---|---|---|
| Android | **Samsung Galaxy S26 Ultra**, Android 16 / One UI 8.5, build `BP4A.251205.006` (D-014) | **preview APK built, NOT YET RUN** |
| iOS | none | **DEFERRED** (D-013) |

**No T-002 device run has happened.** Nothing in this report claims one. Seven of the ten
acceptance criteria are device facts and are therefore **open**:

| Criterion | State |
|---|---|
| AC-2.1 commitment survives restart | **OPEN** — needs a restart on the phone |
| AC-2.2 backfill ≥ 7 nights, with distribution | **OPEN** — needs the real Health Connect history |
| AC-2.3 revise once before 14:00, frozen after | **half met** — proven by test; device check still to do |
| AC-2.4 SQLite write path executes | **OPEN** — the harness toggle exists; nobody has pressed it |
| AC-2.5 45-day retention | **half met** — proven by test; device probe still to do |
| AC-2.6 no network in a full session | **half met** — static scan clean; runtime intercept still to do |
| AC-2.7 preview APK works with the laptop off | **OPEN** |
| AC-2.8 timezone mid-history | **described** (§8), with a real gap named |

---

## 10. Risks

- **The SQLite layer is now load-bearing and still unexecuted.** Every night the app records
  goes through it. If migration 2 or either upsert is wrong, the failure mode is silent — an
  empty history that looks like a member who simply has no data. AC-2.4's forced-fallback path
  is the cheapest way to find out, and it takes one tap.
- **The engine is only as good as one night of real input.** T-001's run 3 proved the read
  path against a single Garmin night. Backfill will exercise it against 30 consecutive real
  nights for the first time, including nights with no watch, partial wear, and possibly two
  sessions. I expect that to surface something.
- **Three manifest-permission bugs in two tasks.** Each was invisible locally and fatal on
  device. Until a check exists that diffs intended permissions against the generated manifest,
  this will keep happening; it is a five-line test and I would rather be told to write it than
  write it unasked in a task that did not scope it.
- **45-day retention caps history**, which will collide with lifetime counters (§6) the moment
  someone completes two cycles. Not a T-002 problem; a T-004 one.

---

## 11. Recommended next step

1. **Run the preview APK and close §9.** In order: set a commitment, force-quit and reopen
   (AC-2.1), read the backfill count and distribution (AC-2.2), tap *Force D-017 fallback* and
   re-read to prove the SQLite write path (AC-2.4), tap *Test 45-day retention* (AC-2.5), and
   leave it overnight for the morning notification (AC-2.7).
2. **Report back the numbers, not a verdict** — row counts before and after, the state
   distribution, and anything the harness printed. I will fill §9 from those.
3. **T-003 (backend, schema, RLS)** — the checker writes that spec. Three things from T-002
   should feed into it: the sync path must treat a non-empty `readErrors` as unknown and never
   persist a failed read as NO_DATA; `daily_states` wants a timezone-offset column so D-016 can
   fire in the field (§8); and a manifest-permission check would have caught three bugs by now.

Status set to **IN_REVIEW**, not DONE. Per CLAUDE.md the checker marks DONE, and with §9 open
this is not a task anyone should be marking done yet.
