# Beacon — Progress

_Last updated: 2026-11-19 14:15. Feature freeze reached; final state below._

## Live at https://d1u6z5us0d06jy.cloudfront.net
- Sign-in (0.4 s), 30-minute sessions renewed while active, lockout, forced temporary-password change.
- "Your next actions" home page for every role (ranked queue, inline approvals for PMs, nav badges); Executive
  home = "Off track" queue followed by the dashboard (health by department, people load, budget against plan).
- Portfolio: "Needs attention" default sort, search, filters ("All", Clear filters), pagination, mobile cards.
- Project workspace: Overview (health with reasons), Milestones & tasks, Status updates, Team (allocations with
  40/60 h warnings), Budget (weekly spend; PMO records), Analysts, Audit; edit with rebaseline reason (PMO) and
  lifecycle locked for PMs; archive/cancel (PMO).
- PM Analyst proposals → PM approvals (approve, reject with reason, 409 on stale).
- People page (load vs 40 h, filters). Admin: user management only (no project data).

## Deliberately cut
See docs/DECISIONS.md Part C (polish pass, budget-burn chart, health trends, 1-minute session warning,
POST /users idempotency, access-audit screen, original-baseline badge, spend delete).

## Risks
- The UI has been verified by component tests, deploy checks and API smoke tests, not yet by a full manual
  click-through. Use the checklist below.
- Aurora auto-pauses after 5 idle minutes; the first request afterwards can take ~15 s. Warm it up before a demo
  (open the portfolio once).

## Click-through checklist (desktop, then 375 px: browser dev tools → iPhone SE / 375 × 667)
| # | Sign in as | Do | Expect |
|---|---|---|---|
| 1 | exec@ | Land on home | "Off track" queue (Red projects, mismatches), then dashboard bars, people tiles, budget table |
| 2 | exec@ | Click a Red bar segment | Portfolio filtered to Red + that department + Active |
| 3 | exec@ | Portfolio → open "Customer Portal Rebuild" | Red badge with reasons; Status mismatch flag; no Edit/Archive buttons |
| 4 | pmo@ | Home | Queue with mismatches, Marcus Webb (> 60 h), "Spend not recorded" (Branch Network Refresh = critical, HR Self-Service Portal = high) |
| 5 | pmo@ | HR Self-Service Portal → Budget → Record weekly spend for last Monday | Saved; queue item for missing spend disappears after refresh |
| 6 | pmo@ | Same project → Edit → change Planned end | "Reason for rebaselining" appears and is required |
| 7 | pm@ | Home | Approvals waiting (approve one inline; reject one with a reason), overdue update, late milestones |
| 8 | pm@ | Branch Network Refresh → Status updates → submit | Update overdue flag clears |
| 9 | pm@ | Own project → Edit | Lifecycle disabled with tooltip; baselines locked; Budget tab has no record button |
| 10 | pm@ | Own project → Team → add a person at 61 h total | Saved with a red "Severely over-allocated" warning |
| 11 | analyst1@ | Home | "Rework needed" (rejected proposal with reason); open a project → Propose change |
| 12 | admin@ | Home, Users | Locked account and role-change items; no Portfolio in nav; unlock the locked user |
| 13 | any, at 375 px | Repeat 1, 7, 8, 11 | Cards, full-width buttons, drawer menu, no horizontal page scroll (tables scroll inside their box) |
