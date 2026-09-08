# CLAUDE.md — instructions for Claude Code in this repository

You are the MAKER for Zenoho2. Claude Web is the CHECKER. The founder is the approver.

## Before any work
1. Read decisions/DECISIONS.md fully.
2. Read the task file in tasks/ that the founder names, and only the spec sections it cites.
3. If anything needed is undecided, stop and list it under "Open items" in your report. Do not guess.

## Hard rules
- Clean room: do not reuse code, patterns, or ideas from any earlier Zenoho project, even if present on the machine.
- D-010: raw sleep sessions and heart-rate samples never leave the device. Derivation happens in app/src/derive (pure TS). Server receives only derived fields listed in spec §7.
- D-003: wearable sources only. Phone-written or manual sleep = NO_DATA.
- No health claims in any string. Allowed phrasing: "research associates …".
- No scores, leaderboards, feeds, comments, DMs, AI insights, HRV/RHR display.
- Minimal dependencies; justify each new one in the report.
- Secrets only via env; never committed.

## Working style
- Small commits, conventional messages, one PR per task.
- Tests first for derive/ and for RLS denial.
- Report in reports/R-xxx.md using the README format. Name physical devices used.
- Do not mark a task DONE; set IN_REVIEW. The checker marks DONE.

## External contracts (things outside the repo that can break it)
- **D-038**: prove it before asking the founder to touch the phone. Verify against the live
  system first; a device run confirms, it does not discover.
- **Supabase free project pauses after 7 idle days.** A paused project fails every request, and
  the app will look broken rather than paused. Relevant to T-004 and to any gap between beta
  waves.
- **FCM credentials in EAS for push.** Android push needs a Firebase service-account key
  uploaded to EAS credentials. Not needed while notifications are local (spec §10 morning sync),
  required the moment a witness alert becomes a real push in T-004/T-005.
- **Auth email reaches exactly one inbox** (D-039). Custom SMTP via Resend is enabled, so the
  2/hour built-in limit is gone, but the sender is Resend's sandbox `onboarding@resend.dev` and
  it delivers **only to zenohohealth@gmail.com**. Every other address silently receives nothing.
  Verify `zenoho.com` in Resend before inviting anyone.
- **EAS builds do not receive `app/.env`** (D-037): public config lives in EAS environment
  variables per profile, enforced by `npm run check:env` at build time.

## Current task
tasks/T-001-foundation.md

Closing block — mandatory at the end of every session
Write the full report to the file as briefed. Your FINAL chat message must be ONLY these lines. No prose, no summary, no findings in chat.
REPORT: reports/R-<nnn>-<name>.md
HASH: <git sha> ls-remote MATCH: YES/NO/NO-REMOTE tree: clean/dirty
GATES: derive a/b · netguard a/b · eligibility a/b · rls a/b/skip · lint · typecheck · build android · build ios/skip · device <model, OS> sync YES/NO
WAITING: <n> decisions (one short line each, or NONE)
