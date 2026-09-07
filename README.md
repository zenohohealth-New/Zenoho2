# ZENOHO2

Clean-room restart. Nothing from prior Zenoho attempts is trusted or imported.

## Structure
```
/spec       product + technical specifications (authoritative, versioned)
/decisions  DECISIONS.md — the only source of truth for what was decided and why
/tasks      one file per task for Claude Code; status READY / IN_PROGRESS / IN_REVIEW / DONE
/reports    implementation reports from Claude Code, one per task (R-xxx)
/tests      fixtures + cross-cutting tests (derivation cases, RLS denial, network guard)
/app        Expo (React Native) mobile app
/backend    schema, RLS policies, edge/cron functions (from T-002 onward)
/archive    superseded material; never referenced by live code
```

## Loop
Founder → Claude Web (think/specify) → Claude Code (build/test) → Claude Web (review vs acceptance criteria) → Claude Code (fix) → Claude Web (re-check) → approved → staging → founder acceptance → production.
"Code runs" ≠ "feature approved". Approval = every acceptance criterion in the task has evidence in the report.

## Implementation report format (reports/R-xxx.md)
1. What changed  2. Files changed  3. Tests run  4. Tests passed/failed  5. Assumptions  6. Unresolved issues  7. Risks  8. Recommended next step  9. Devices used (physical, with OS version)

## Rules for the maker (Claude Code)
- Read DECISIONS.md and the task's spec sections before touching code.
- Do not exceed the task's scope; surface scope questions in the report, don't resolve them.
- Never send raw HealthKit/Health Connect values to any network endpoint (D-010).
- Never introduce a health claim in copy; use "research associates…" only.
- Never invent a decision; if a decision is missing, stop and write it as an open item.
- Commit small; conventional commit messages; one PR per task.
